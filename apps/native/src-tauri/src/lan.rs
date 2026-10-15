//! 面对面同步：同一个 Wi-Fi 下两台设备直接传学习记录，不经过任何服务器。
//!
//! 一台“出码”：在局域网上临时开一个端口，等另一台连过来；另一台“扫码”连上，双方各交出一份
//! 加密好的快照（前端用配对码派生的 AES 密钥加密，这里只当不透明的文本搬运），一来一回就结束。
//!
//! 线上格式（TCP）：
//!   连过来的一方：`SAYDAY-LAN 1\n<tag>\n<字节数>\n<内容>`
//!   出码的一方：  `OK\n<字节数>\n<内容>`，tag 不对回 `NO\n`
//! tag 由配对码派生，用来挡掉同一网络里乱连的；内容本身是密文，tag 对了也读不到。

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

/// 优先用这个端口（输入地址时可以不写端口），被占了就随便挑一个
pub const PORT: u16 = 47231;
const MAGIC: &str = "SAYDAY-LAN 1";
const MAX: usize = 64 << 20;
const WAIT: Duration = Duration::from_secs(300);

enum Got {
    Waiting,
    Payload(String),
    Failed(String),
}

struct Host {
    stop: Arc<AtomicBool>,
    got: Arc<Mutex<Got>>,
}

static HOST: Mutex<Option<Host>> = Mutex::new(None);

/// 本机在局域网里的地址：问系统“去外网走哪张网卡”（UDP connect 不发包）。
/// 手机自己开热点等情况这里可能拿不到，安卓那边另外列网卡补上
pub fn local_addrs() -> Vec<String> {
    let mut out = Vec::new();
    for target in ["8.8.8.8:80", "223.5.5.5:80", "10.255.255.255:9", "192.168.255.255:9", "172.31.255.255:9"] {
        if let Ok(s) = UdpSocket::bind("0.0.0.0:0") {
            if s.connect(target).is_ok() {
                if let Ok(SocketAddr::V4(a)) = s.local_addr() {
                    let ip = a.ip();
                    if !ip.is_unspecified() && !ip.is_loopback() {
                        let t = ip.to_string();
                        if !out.contains(&t) {
                            out.push(t);
                        }
                    }
                }
            }
        }
    }
    // 局域网地址排前面
    out.sort_by_key(|ip| !ip.parse::<std::net::Ipv4Addr>().map(|a| a.is_private()).unwrap_or(false));
    out
}

fn read_line(r: &mut impl BufRead) -> std::io::Result<String> {
    let mut s = String::new();
    r.take(256).read_line(&mut s)?;
    if !s.ends_with('\n') {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "格式不对"));
    }
    Ok(s.trim_end().to_string())
}

fn read_body(r: &mut impl BufRead) -> std::io::Result<String> {
    let n: usize = read_line(r)?.parse().map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "长度不对"))?;
    if n > MAX {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "太大了"));
    }
    let mut buf = vec![0u8; n];
    r.read_exact(&mut buf)?;
    String::from_utf8(buf).map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "内容不对"))
}

/// 处理一个连进来的请求：tag 对就交换，返回对方的内容；不对返回 None 继续等
fn serve_one(stream: TcpStream, tag: &str, payload: &str) -> Option<String> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(30))).ok()?;
    let mut w = stream.try_clone().ok()?;
    let mut r = BufReader::new(stream);
    if read_line(&mut r).ok()? != MAGIC {
        return None;
    }
    if read_line(&mut r).ok()? != tag {
        let _ = w.write_all(b"NO\n");
        return None;
    }
    let theirs = read_body(&mut r).ok()?;
    w.write_all(format!("OK\n{}\n", payload.len()).as_bytes()).ok()?;
    w.write_all(payload.as_bytes()).ok()?;
    w.flush().ok()?;
    Some(theirs)
}

/// 开始出码：开端口等对方连过来。返回端口号
pub fn host(payload: String, tag: String) -> Result<u16, String> {
    stop();
    let listener = TcpListener::bind(("0.0.0.0", PORT))
        .or_else(|_| TcpListener::bind(("0.0.0.0", 0)))
        .map_err(|e| format!("开不了端口：{e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let got = Arc::new(Mutex::new(Got::Waiting));
    *HOST.lock().unwrap() = Some(Host { stop: stop_flag.clone(), got: got.clone() });
    std::thread::spawn(move || {
        let start = Instant::now();
        loop {
            if stop_flag.load(Ordering::SeqCst) {
                return;
            }
            if start.elapsed() > WAIT {
                *got.lock().unwrap() = Got::Failed("等太久了，重新出码再试".into());
                return;
            }
            match listener.accept() {
                Ok((s, _)) => {
                    if let Some(theirs) = serve_one(s, &tag, &payload) {
                        *got.lock().unwrap() = Got::Payload(theirs);
                        return;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
                Err(e) => {
                    *got.lock().unwrap() = Got::Failed(format!("等待连接出错：{e}"));
                    return;
                }
            }
        }
    });
    Ok(port)
}

/// 出码这边看看对方连上没有：Ok(None) = 还在等；Ok(Some) = 收到了（只给一次）
pub fn poll() -> Result<Option<String>, String> {
    let mut h = HOST.lock().unwrap();
    let Some(host) = h.as_ref() else { return Err("没有在出码".into()) };
    let mut g = host.got.lock().unwrap();
    match std::mem::replace(&mut *g, Got::Waiting) {
        Got::Waiting => Ok(None),
        Got::Payload(p) => {
            drop(g);
            *h = None;
            Ok(Some(p))
        }
        Got::Failed(e) => {
            drop(g);
            *h = None;
            Err(e)
        }
    }
}

pub fn stop() {
    if let Some(h) = HOST.lock().unwrap().take() {
        h.stop.store(true, Ordering::SeqCst);
    }
}

fn exchange(addr: SocketAddr, tag: &str, payload: &str) -> Result<String, String> {
    let s = TcpStream::connect_timeout(&addr, Duration::from_secs(4)).map_err(|e| format!("连不上 {addr}：{e}"))?;
    s.set_read_timeout(Some(Duration::from_secs(60))).map_err(|e| e.to_string())?;
    s.set_write_timeout(Some(Duration::from_secs(60))).map_err(|e| e.to_string())?;
    let mut w = s.try_clone().map_err(|e| e.to_string())?;
    w.write_all(format!("{MAGIC}\n{tag}\n{}\n", payload.len()).as_bytes()).map_err(|e| e.to_string())?;
    w.write_all(payload.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())?;
    let mut r = BufReader::new(s);
    match read_line(&mut r).map_err(|e| format!("对方没有回应：{e}"))?.as_str() {
        "OK" => read_body(&mut r).map_err(|e| format!("接收中断：{e}")),
        "NO" => Err("配对码不对".into()),
        _ => Err("对方不是日日说".into()),
    }
}

/// 连到出码的设备：几个候选地址同时试，哪个先通用哪个。返回对方的内容
pub fn send(addrs: Vec<String>, port: u16, tag: String, payload: String) -> Result<String, String> {
    let targets: Vec<SocketAddr> = addrs
        .iter()
        .filter_map(|a| a.trim().parse::<IpAddr>().ok())
        .map(|ip| SocketAddr::new(ip, port))
        .collect();
    if targets.is_empty() {
        return Err("地址不对".into());
    }
    let (tx, rx) = mpsc::channel();
    let payload = Arc::new(payload);
    let tag = Arc::new(tag);
    for addr in targets.clone() {
        let (tx, payload, tag) = (tx.clone(), payload.clone(), tag.clone());
        std::thread::spawn(move || {
            let _ = tx.send(exchange(addr, &tag, &payload));
        });
    }
    drop(tx);
    let mut last = String::from("连不上");
    for r in rx {
        match r {
            Ok(p) => return Ok(p),
            // 配对码不对比“连不上”更有用，优先报
            Err(e) => {
                if e == "配对码不对" || !last.starts_with("配对码") {
                    last = e
                }
            }
        }
    }
    Err(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_wrong_tag() {
        let port = host("HOST-DATA".into(), "tag1".into()).unwrap();
        assert_eq!(poll().unwrap(), None);
        let ip = vec!["127.0.0.1".to_string()];
        assert_eq!(send(ip.clone(), port, "bad".into(), "x".into()).unwrap_err(), "配对码不对");
        assert_eq!(poll().unwrap(), None);
        let big = "c".repeat(3 << 20);
        assert_eq!(send(ip.clone(), port, "tag1".into(), big.clone()).unwrap(), "HOST-DATA");
        assert_eq!(poll().unwrap(), Some(big));
        assert!(poll().is_err());
        // 不通的地址和通的地址一起给，能用通的那个
        let port = host("H2".into(), "t".into()).unwrap();
        assert_eq!(send(vec!["10.254.254.254".into(), "127.0.0.1".into()], port, "t".into(), "C2".into()).unwrap(), "H2");
        assert_eq!(poll().unwrap(), Some("C2".into()));
        stop();
        assert!(!local_addrs().iter().any(|a| a == "127.0.0.1"));
    }
}

// 端到端断言：不对就记下接着跑（一次看全哪些坏了），最后 done() 汇总，有一项不对退出码就是 1（CI 靠它判红）
const fails = []
export function expect(ok, what, got) {
  console.log(ok ? '✓' : '✗', what, got === undefined ? '' : `（实际：${typeof got === 'string' ? got : JSON.stringify(got)}）`)
  if (!ok) fails.push(what)
}
export function done() {
  if (fails.length) { console.error(`✗ ${fails.length} 项不对：${fails.join('；')}`); process.exitCode = 1 }
  else console.log('✓ 全部通过')
}

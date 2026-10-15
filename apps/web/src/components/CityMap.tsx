// 城市地图：四座城，每集一个地方。看完那集就点亮，写着在那儿能用英语做到什么
import { CITIES } from '../lib/citymap'
import { key, type EpProgress } from '../lib/episodes'
import { Overlay } from './Overlay'

export function CityMap({ p, onClose }: { p: EpProgress; onClose: () => void }) {
  const lit = CITIES.reduce((n, c) => n + c.places.filter((_, i) => p.done[key(c.season, i + 1)]).length, 0)
  const total = CITIES.reduce((n, c) => n + c.places.length, 0)
  return (
    <Overlay title="城市地图" sub={`点亮了 ${lit} / ${total} 个地方`} onClose={onClose}>
      <div className="citymap fade-in">
        {CITIES.map((c) => {
          const n = c.places.filter((_, i) => p.done[key(c.season, i + 1)]).length
          return (
            <section key={c.season}>
              <p className="section-title">{c.city_zh} <span className="faint small en">{c.city}</span><span className="small muted"> · {n}/{c.places.length}</span></p>
              <div className="city-grid">
                {c.places.map((pl, i) => {
                  const on = !!p.done[key(c.season, i + 1)]
                  return (
                    <div key={i} className={`place ${on ? 'on' : ''}`}>
                      <span className="no">{i + 1}</span>
                      {on ? <><b className="en">{pl.en}</b><span className="small">{pl.zh}</span><span className="small muted">能{pl.can}</span></> : <><b className="small muted">第 {c.season} 季第 {i + 1} 集</b><span className="small faint">看完就点亮</span></>}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </Overlay>
  )
}

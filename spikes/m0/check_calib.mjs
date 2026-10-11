// 对拍 JS 校准推理与 sklearn：node check_calib.mjs
import { readFileSync } from 'node:fs'
import { predict } from './web/calib.mjs'
const model = JSON.parse(readFileSync(new URL('./web/samples/calib.json', import.meta.url)))
const { X, y } = JSON.parse(readFileSync('/root/sayday/.cache/calib_check.json'))
let worst = 0
const t0 = performance.now()
X.forEach((x, i) => { worst = Math.max(worst, Math.abs(predict(model, x) - y[i])) })
console.log(JSON.stringify({ n: X.length, maxAbsDiff: worst, usPerPhone: +(((performance.now() - t0) * 1000) / X.length).toFixed(1) }))

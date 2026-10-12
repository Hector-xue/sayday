// 词书：按考试大纲学新词。标签来自 ECDICT（中考 zk、高考 gk、四级 cet4、六级 cet6、考研 ky、雅思、托福、GRE），
// 只收本 App 词表（最常用的 1.2 万词）里有的。没选词书（profile.book 未设）时保持原来的做法：按常用程度往上学，雅思目标优先雅思词
import type { Word } from './content'

export type Book = { tag: string; name: string; desc: string }
export const BOOKS: Book[] = [
  { tag: 'zk', name: '中考', desc: '初中核心词' },
  { tag: 'gk', name: '高考', desc: '高中课标词' },
  { tag: 'cet4', name: '大学四级', desc: 'CET-4 大纲' },
  { tag: 'cet6', name: '大学六级', desc: 'CET-6 大纲' },
  { tag: 'ky', name: '考研', desc: '考研英语大纲' },
  { tag: 'ielts', name: '雅思', desc: 'IELTS 常考词' },
  { tag: 'toefl', name: '托福', desc: 'TOEFL 常考词' },
  { tag: 'gre', name: 'GRE', desc: 'GRE 常考词' },
]
export const bookName = (tag?: string) => BOOKS.find((b) => b.tag === tag)?.name ?? '按常用程度'

export const inBook = (w: Word, tag: string) => w.tags.includes(tag)

/**
 * 词书模式下的新词顺序：书里还没学的词，先从你的水平附近往难里学，学完再回头补前面那些常用的（多半认识，点“早就认识”很快）；
 * 整本学完了接着按常用程度学书外的词。learnable：能进词卡的词（有发音、不是虚词、不敏感、还没学）
 */
export function bookOrder(learnable: Word[], tag: string, frontier: number): Word[] {
  const from = Math.max(1, Math.round(frontier * 0.6))
  const book = learnable.filter((w) => inBook(w, tag))
  const ahead = book.filter((w) => w.rank >= from)
  const behind = book.filter((w) => w.rank < from)
  const rest = learnable.filter((w) => !inBook(w, tag) && w.rank >= frontier)
  return [...ahead, ...behind, ...rest]
}

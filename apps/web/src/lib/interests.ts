// 兴趣标签（方案 1.4）：选几个兴趣，每日听力和跟读的例句优先从这些话题里挑。
// 话题按例句里出现的词判断（每个话题一组常见词）；没选兴趣 = 和以前一样随机
import { kvGet, kvSet } from './db'
import type { Sentence } from './content'

export type Topic = { id: string; zh: string; words: string[] }
export const TOPICS: Topic[] = [
  { id: 'business', zh: '电商和生意', words: ['order', 'price', 'customer', 'delivery', 'product', 'shop', 'sell', 'buy', 'business', 'market', 'company', 'money', 'pay', 'cost', 'sale', 'store', 'client', 'deal', 'profit', 'parcel'] },
  { id: 'work', zh: '职场', words: ['office', 'meeting', 'job', 'manager', 'colleague', 'project', 'email', 'boss', 'salary', 'work', 'career', 'interview', 'deadline', 'report', 'team', 'staff', 'employee', 'contract'] },
  { id: 'tech', zh: '科技', words: ['computer', 'phone', 'internet', 'software', 'data', 'online', 'digital', 'technology', 'screen', 'website', 'robot', 'machine', 'program', 'device', 'battery', 'camera', 'network', 'video'] },
  { id: 'sport', zh: '运动和足球', words: ['football', 'team', 'match', 'goal', 'player', 'game', 'win', 'score', 'sport', 'coach', 'race', 'ball', 'club', 'champion', 'run', 'swim', 'gym', 'training'] },
  { id: 'food', zh: '美食', words: ['cook', 'food', 'eat', 'kitchen', 'restaurant', 'dinner', 'taste', 'recipe', 'coffee', 'tea', 'meal', 'bread', 'lunch', 'breakfast', 'cake', 'chicken', 'rice', 'fruit', 'delicious'] },
  { id: 'travel', zh: '旅行', words: ['travel', 'trip', 'hotel', 'flight', 'airport', 'city', 'visit', 'holiday', 'map', 'ticket', 'train', 'beach', 'country', 'tourist', 'passport', 'journey', 'abroad', 'station'] },
  { id: 'film', zh: '影视和音乐', words: ['film', 'movie', 'music', 'song', 'actor', 'show', 'cinema', 'band', 'concert', 'story', 'singer', 'television', 'theatre', 'dance', 'guitar', 'piano', 'novel', 'artist'] },
  { id: 'health', zh: '健康', words: ['doctor', 'health', 'exercise', 'sleep', 'hospital', 'medicine', 'healthy', 'ill', 'sick', 'pain', 'nurse', 'diet', 'weight', 'body', 'heart', 'tired', 'disease', 'fit'] },
  { id: 'nature', zh: '自然和动物', words: ['dog', 'cat', 'animal', 'tree', 'garden', 'river', 'sea', 'weather', 'bird', 'forest', 'mountain', 'flower', 'rain', 'snow', 'horse', 'fish', 'sun', 'lake'] },
  { id: 'study', zh: '学习和校园', words: ['school', 'study', 'student', 'teacher', 'university', 'exam', 'learn', 'science', 'research', 'book', 'class', 'lesson', 'library', 'homework', 'language', 'history', 'college', 'degree'] },
]

export const getInterests = () => kvGet<string[]>('interests', [])
export const setInterests = (ids: string[]) => kvSet('interests', ids)

/** 句子属不属于选中的这些话题（句子里出现话题词） */
export function topicMatcher(ids: string[]): ((s: Sentence) => boolean) | null {
  const set = new Set(TOPICS.filter((t) => ids.includes(t.id)).flatMap((t) => t.words))
  if (!set.size) return null
  return (s) => s.words.some((w) => set.has(w))
}

/**
 * 从候选池里挑句子时偏向兴趣：七成从话题句里挑（话题句少于 10 句就不偏），三成照旧随机，免得天天同一类。
 * 返回这一次要从哪个池子里挑
 */
export function preferTopics<T extends Sentence>(pool: T[], match: ((s: Sentence) => boolean) | null, rnd = Math.random): T[] {
  if (!match) return pool
  const hit = pool.filter(match)
  return hit.length >= 10 && rnd() < 0.7 ? hit : pool
}

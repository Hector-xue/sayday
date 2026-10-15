// 城市地图（方案 1.7）：剧集里去过的地方，看完那一集就点亮；每个地方对应一项“在那儿能用英语做到的事”
export type Place = { en: string; zh: string; can: string }
export type City = { season: number; city: string; city_zh: string; places: Place[] }

export const CITIES: City[] = [
  { season: 1, city: 'London', city_zh: '伦敦 · 卡姆登', places: [
    { en: 'Your Flat', zh: '新家门口', can: '自我介绍、问房子的事' },
    { en: 'Corner Shop', zh: '街角小店', can: '买东西、问价、刷卡' },
    { en: 'The Office', zh: '新公司', can: '和新同事寒暄' },
    { en: "Regent's Canal", zh: '摄政运河', can: '借东西、关心朋友' },
    { en: 'The Blue Door', zh: '蓝门咖啡馆', can: '敲门说明来意' },
    { en: 'The GP Surgery', zh: '社区诊所', can: '请病假、预约看病' },
    { en: 'The Kitchen', zh: '合租厨房', can: '提议、商量计划' },
    { en: 'Meeting Room', zh: '会议室', can: '听懂英式客气话' },
    { en: 'Camden High Street', zh: '卡姆登大街', can: '一起出主意做宣传' },
    { en: "Emma's Bookshop", zh: 'Emma 的书店', can: '在一群人面前说话' },
  ] },
  { season: 2, city: 'Edinburgh', city_zh: '爱丁堡', places: [
    { en: 'The Sleeper Train', zh: '卧铺夜车', can: '和陌生人聊开' },
    { en: "Sophie's Kitchen", zh: 'Sophie 的厨房', can: '赴约、主动帮忙' },
    { en: 'The Theatre', zh: '剧院', can: '听懂美式说法、谈截止日期' },
    { en: "Arthur's Seat", zh: '亚瑟王座', can: '鼓励朋友' },
    { en: 'The Grassmarket', zh: '草地市场', can: '出主意救场' },
    { en: "Morag's Hall", zh: '老教堂大厅', can: '礼貌地请求、谈条件' },
    { en: 'The Boardroom', zh: '投资人会议室', can: '做提案路演' },
    { en: 'The Royal Mile', zh: '皇家一英里', can: '临场应变' },
    { en: 'A Rented Room', zh: '住处', can: '分享好消息' },
    { en: 'The Ceilidh', zh: '苏格兰舞会', can: '婉拒邀请但留余地' },
  ] },
  { season: 3, city: 'London', city_zh: '回到伦敦', places: [
    { en: "King's Cross", zh: '国王十字车站', can: '久别重逢聊近况' },
    { en: 'Blue Door Lessons', zh: '蓝门口语课', can: '争取思考时间、把话说具体' },
    { en: "The Client's Office", zh: '客户办公室', can: '婉拒、给折中方案' },
    { en: 'The Big Meeting', zh: '部门会议', can: '讲清一张图表' },
    { en: 'The Test Centre', zh: '考场', can: '完成雅思口语第二、三部分' },
    { en: 'Results Day', zh: '出成绩那天', can: '读懂成绩、庆祝' },
    { en: 'The Design School', zh: '设计学院', can: '应对面试' },
    { en: 'The Seminar Room', zh: '研讨室', can: '有礼貌地争论' },
    { en: 'The Late-night Call', zh: '深夜电话', can: '谈合作条件' },
    { en: 'The Little Stage', zh: '蓝门小讲台', can: '公开演讲' },
  ] },
  { season: 4, city: 'New York', city_zh: '纽约', places: [
    { en: 'JFK Airport', zh: '肯尼迪机场', can: '落地后的寒暄' },
    { en: 'The Studio', zh: '设计工作室', can: '听懂美式职场黑话' },
    { en: 'A Brooklyn Walk-up', zh: '布鲁克林老楼', can: '和房东打交道' },
    { en: 'The Brunch Spot', zh: '早午餐店', can: '点餐、付小费' },
    { en: 'Jackson Heights Library', zh: '杰克逊高地图书馆', can: '了解客户需求' },
    { en: 'The Creative Room', zh: '创意会', can: '提出点子、算预算' },
    { en: 'Town Hall', zh: '市民大会', can: '面对质疑发言' },
    { en: 'The Reading Corner', zh: '阅览角', can: '鼓励一个不敢开口的人' },
    { en: 'Times Square', zh: '时代广场', can: '带朋友逛城市' },
    { en: 'The Painted Wall', zh: '写满“家”的墙', can: '把好意传下去' },
  ] },
]

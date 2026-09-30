/**
 * Reference data for the dev seed: class register (docs/10-integrations.md §1.4) and zones (§1.5).
 * Real class and zone names only — never real student data.
 */

type Track = 'general' | 'religious' | 'vocational';

export interface SeedClass {
  track: Track;
  gradeCode: string;
  gradeLabel: string;
  rankGroup: string;
  roomNo: number;
  name: string;
  displayName: string;
  /** Strings as they appear in the student API; each is stored as a lookup key in class_aliases. */
  sourceStrings: string[];
}

const M123 = [
  'Amanah',
  'Berdikari',
  'Cergas',
  'Dedikasi',
  'Fatanah',
  'Hormat',
  'Ikhlas',
  'Mulia',
  'Patuh',
  'Usaha',
  'Wawasan',
  'Yakin',
];
const M456 = [
  'Intan',
  'Delima',
  'Nilam',
  'Kristal',
  'Al-Khawarizmi',
  "Ash-Shafi'i",
  'Al-Biruni',
  'Amber',
  'Mutiara',
  'Topaz',
];

/** Known misspellings in the student API, per class name (§1.4 seed aliases). */
const SPELLINGS: Record<string, string[]> = {
  Usaha: ['Usaha(Ijtihad)'],
  Ikhlas: ['Iklas'],
  'Al-Biruni': ['Biruni'],
};

function general(grade: number, names: string[]): SeedClass[] {
  return names.map((name, i) => {
    const label = `ม.${grade}`;
    const room = i + 1;
    return {
      track: 'general',
      gradeCode: `M${grade}`,
      gradeLabel: label,
      rankGroup: label,
      roomNo: room,
      name,
      displayName: `${label} ${name}`,
      sourceStrings: [name, ...(SPELLINGS[name] ?? [])].map((n) => `${label}/${room} ${n}`),
    };
  });
}

function vocational(grade: number, rooms: number[]): SeedClass[] {
  return rooms.map((room) => {
    const name = `ปวช.${grade}/${room}`;
    return {
      track: 'vocational',
      gradeCode: `VOC${grade}`,
      gradeLabel: `ปวช.${grade}`,
      rankGroup: 'ปวช.',
      roomNo: room,
      name,
      displayName: name,
      sourceStrings: [name],
    };
  });
}

function sanawi(year: number, names: string[]): SeedClass[] {
  return names.map((n, i) => ({
    track: 'religious',
    gradeCode: `REL-SAN${year}`,
    gradeLabel: `ซานาวี ปี ${year}`,
    rankGroup: 'ซานาวี',
    roomNo: i + 1,
    name: `${year}S ${n}`,
    displayName: `ซานาวี ปี ${year} ${n}`,
    sourceStrings: [`${year}S ${n}`],
  }));
}

export const SEED_CLASSES: SeedClass[] = [
  ...general(1, M123),
  ...general(2, [...M123, 'Zikir']),
  ...general(3, M123),
  ...general(4, [...M456, 'Berlian']),
  ...general(5, M456),
  ...general(6, M456),
  ...sanawi(2, ['Al-Bukhari', 'Muslim']),
  ...sanawi(3, ['Al-Bukhari', 'Muslim']),
  ...vocational(1, [1]),
  ...vocational(2, [1, 2]),
  ...vocational(3, [1, 2]),
];

export const SEED_ZONES: { code: string; description: string }[] = [
  { code: 'A', description: 'ประตูใหญ่ทางเข้าโรงเรียน หน้าถนน ประตูหอพักชายถึงหน้ากูโบร์' },
  { code: 'B', description: 'ลานจอดรถนักเรียนชาย ถึงถนนหน้าบอร์ดประกาศ' },
  {
    code: 'C',
    description: 'อาคารวิทยาลัยเทคโนโลยีอาซิซสถาน ชั้น 1–2, บอร์ดประชาสัมพันธ์กลาง, ที่จอดรถและประตูทางเข้าอาคาร ปวช.',
  },
  { code: 'D', description: 'ใต้ต้นประดู่, สนามปิงปอง, หน้าเสาธง, สนามบาสเก็ตบอล' },
  {
    code: 'E',
    description:
      'ชั้นล่างอาคาร 1 หน้าห้องสมุด, ห้องประชุมอาคาร 1, หน้าห้องผู้บริหาร, ลานจอดรถ, ถนนหน้ามุกเสาธงถึงห้องสมุด',
  },
  {
    code: 'F',
    description:
      'ชั้นล่างอาคาร 1 ฝั่งห้องสัมพันธ์ชุมชน–ห้องธุรการการเงิน–ห้องบุคลากร–ห้องวิชาการ–ห้องพักครูศาสนา, ลานจอดรถ, ถนนถึงทางเข้าสนามบอลฝั่งน้ำตก',
  },
  {
    code: 'G',
    description: 'สวนน้ำตก, ห้องน้ำบุคลากรหญิง, หน้าห้องพักครูหญิง, ห้องแนะแนว, หน้าห้องพักครูชาย, จุดบริการน้ำดื่ม',
  },
  {
    code: 'H',
    description: 'หน้าอาคาร 2–3, ศูนย์ภาษา, ห้องพยาบาล, ห้องน้ำนักเรียนหญิง, หน้าอาคาร 4 สหกรณ์ชายและลานข้างสหกรณ์ชาย',
  },
  { code: 'I', description: 'โรงอาหารหญิงใต้มูซอลลาหญิง, ทางเดินระหว่างโรงอาหาร, โรงอาหารฝั่งกำแพง' },
  { code: 'J', description: 'บนมูซอลลาหญิง, บันไดมูซอลลาหญิงทั้ง 2 ฝั่ง, ที่เอาน้ำละหมาดหญิง' },
  { code: 'K', description: 'ถนนทางเข้าโรงอาหารฝั่ง ปวช., ลานอเนกประสงค์โรงอาหารหญิงหลังห้องสมุดถึงประตูสหกรณ์หญิง' },
  {
    code: 'L',
    description:
      'มูซอลลาหญิงใต้อาคาร 5, บันไดทุกชั้นฝั่งห้องเรียน AEP, หน้าห้องคอมพิวเตอร์ 4, หน้าห้องประชุมและหลังอาคาร 5',
  },
  { code: 'M', description: 'โรงอาหารชาย, ลานจอดรถหน้าอาคาร 5, คูน้ำทั้ง 2 ฝั่ง' },
  {
    code: 'N',
    description: 'ทางเดินหลังโรงอาหารชาย, ลานอเนกประสงค์ใกล้จุดขายน้ำดื่มชาย, รอบมัสยิดหลังอาคาร 5 ถึงรั้วโรงเรียน',
  },
  { code: 'O', description: 'มูซอลลาชาย, ลานมูซอลลา, ห้องน้ำนักเรียนชาย (ใหม่)' },
  { code: 'P', description: 'ลานอเนกประสงค์หลังอาคาร 5 ใกล้โรงผลิตน้ำดื่ม' },
  { code: 'Q', description: 'หน้า–หลังอาคาร 6 ห้องปฏิบัติการ บันได ทางเดิน ห้องน้ำนักเรียนและครู ข้างโรงยิม' },
  { code: 'R', description: 'โรงยิมเนเซียมภายในและหน้าโรงยิม, ห้องน้ำนักเรียนชายฝั่งห้องพยาบาล, หน้าห้องพักครูพละ' },
  { code: 'S', description: 'ถนน 3 แยกทางขึ้นน้ำตก, ประตูทางออก, โรงเรือนไฮโดรโพนิกส์, โรงองุ่น, คูน้ำข้างอาคาร 6' },
  { code: 'T', description: 'สวนสัตว์, ทางเดินหลังกรงนก, คูน้ำฝั่งหน้าโรงยิม, สวนหย่อมบน–หน้าน้ำตก' },
  { code: 'U', description: 'บันไดอาคาร 1 ฝั่งห้องสัมพันธ์ชุมชนและฝั่งห้องวิชาการ ทุกชั้น' },
  { code: 'V', description: 'บันไดอาคาร 1 ฝั่งห้องสมุดและฝั่งห้องปกครอง ทุกชั้น' },
  { code: 'W', description: 'บันไดกลางอาคาร 5 และบันไดฝั่งมูซอลลาชาย ทุกชั้น' },
  { code: 'X', description: 'อัฒจันทร์ทั้งหมด (ฝั่งกูโบร์ถึงโรงเกษตร), สนามฟุตบอล, สนามซ้อมฟุตบอล' },
  { code: 'Y', description: 'รอบอาคารศิลปะ และลานหน้าอาคารศิลปะ' },
];

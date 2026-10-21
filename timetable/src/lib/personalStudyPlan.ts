import type { PlanCategory, SisuPlanItem } from './sisuStudyPlan'

/**
 * The user's Sisu study plan (20.08.2026), transcribed from the SISU plan PDF.
 *
 * Privacy: this file intentionally contains course data only. The PDF's name and
 * student number are NOT stored anywhere; do not add them.
 *
 * The PDF's planned timing is kept as the baseline plan. Actual SISU 2026–27
 * teaching periods live in `sisuCourseFacts.ts` and are what the scenario engine
 * uses when deciding whether a course can be moved.
 */
export interface PersonalPlanCourse {
  code: string
  title: string
  credits: number
  creditRange?: { min: number; max: number }
  category: PlanCategory
  studyYear?: string
  periods?: number[]
  timingNote?: string
  completed?: boolean
  grade?: number | 'pass'
  groupKey?: string
  groupTitle?: string
  sisuId?: string
}

export const PERSONAL_PLAN_DATE = '2026-08-20'

export const PERSONAL_PLAN_META = {
  programme: 'TiBScLah_DD Software and Systems Engineering',
  goalCredits: 180,
  totalCredits: 209,
  creditRange: '209–211',
  completedCredits: 13,
} as const

export const PERSONAL_PLAN_CATEGORY_MINIMUMS: Record<PlanCategory, number> = {
  general: 31,
  language: 10,
  intermediate: 103,
  minor: 20,
  elective: 0,
}

const moocGroup = (groupKey: string, groupTitle: string) => ({ groupKey, groupTitle })

export const PERSONAL_PLAN_COURSES: readonly PersonalPlanCourse[] = [
  // General studies — 40 / min 31
  { code: 'CT60A5550', title: 'Software Project Management (Lahti)', credits: 3, category: 'general', studyYear: '2027-2028', periods: [3, 4], sisuId: 'otm-a95e57d5-54a2-4db1-b92f-6b3c800c35f1' },
  { code: 'BM20A9200', title: 'Mathematics A', credits: 6, category: 'general', studyYear: '2026-2027', periods: [1, 2], sisuId: 'otm-eeae8c76-238c-4cb0-bce7-352477020c44' },
  { code: 'CT60A4050', title: 'Fundamentals of Software Engineering', credits: 6, category: 'general', studyYear: '2026-2027', periods: [1, 2], sisuId: 'otm-5adbe49e-e82d-43d3-9a0d-35f35aff6ae2' },
  { code: 'BM20A9301', title: 'Statistics', credits: 3, category: 'general', studyYear: '2026-2027', periods: [3], sisuId: 'otm-fc5eed1a-6b16-4b7f-b5b1-5f2fe4998608' },
  { code: 'CT10A9900', title: 'Introduction to DD Studies in Software and Systems Engineering', credits: 1, category: 'general', studyYear: '2026-2027', periods: [1, 2, 3, 4], sisuId: 'otm-bccf345b-56be-48d8-84e0-f069d582d254' },
  { code: 'CT60A0250', title: 'Fundamentals of Programming for international programs', credits: 6, category: 'general', studyYear: '2026-2027', periods: [1, 2], sisuId: 'otm-56b754af-4555-4b08-8a1b-7f375fd6fc91' },
  { code: 'CT60A2700', title: 'Software development with the C-programming language for international programs', credits: 6, category: 'general', studyYear: '2027-2028', periods: [3, 4], sisuId: 'otm-a3e37751-a2dd-4114-82c3-e77174abd5eb' },
  { code: 'HDD4100', title: 'Engineering Project Management (HDD)', credits: 3, category: 'general', studyYear: '2028-2029', periods: [1], sisuId: 'otm-1bacc350-6ed2-49d6-9ca3-54d18a42e8d8' },
  { code: 'HDD4110', title: 'Systems Engineering (HDD)', credits: 3, category: 'general', studyYear: '2027-2028', periods: [1, 2], sisuId: 'otm-20109b79-2071-4b00-9035-3d798d49036c' },
  { code: 'HDD4130', title: 'Lean Management (HDD)', credits: 3, category: 'general', studyYear: '2028-2029', periods: [2], sisuId: 'otm-60b12341-9b0d-40e0-8b20-4c756654a5d9' },

  // Language and communication — 10 / min 10 (3 completed)
  { code: 'KE00BX35', title: 'English Pronunciation', credits: 1, category: 'language', studyYear: '2026-2027', periods: [1], timingNote: 'SISU also offers P3–P4 windows', sisuId: 'otm-ca0ba09f-d970-44d5-a724-e8fbe24433cb' },
  { code: 'KE00DA03', title: 'English for the Hebei University of Technology', credits: 3, category: 'language', studyYear: '2026-2027', periods: [1, 2], sisuId: 'otm-5b22322d-7138-4df2-ae75-24464db1a33d' },
  { code: 'K200DJ96', title: 'Finnish 1', credits: 3, category: 'language', completed: true, grade: 5, timingNote: 'Completed 16.10.2026; not in the public SISU catalogue' },
  { code: 'K200DJ99', title: 'Finnish 2', credits: 3, category: 'language', studyYear: '2026-2027', periods: [2], timingNote: 'SISU also offers a P4 window; not in the public catalogue', },

  // Intermediate specialisation — 103 / min 103
  { code: 'CT60A2450', title: 'Object-Oriented Programming (Lahti & Online)', credits: 6, category: 'intermediate', studyYear: '2026-2027', periods: [3, 4], sisuId: 'otm-df7f6f62-2837-4e4c-b3b7-b49af8f26b40' },
  { code: 'CT30A2850', title: 'User Interfaces and Usability for international programs', credits: 6, category: 'intermediate', studyYear: '2026-2027', periods: [3, 4], sisuId: 'otm-2b6ca844-ba53-4fe1-ae14-57a9088d3e2a' },
  { code: 'BM20A8801', title: 'Discrete Mathematics', credits: 3, category: 'intermediate', studyYear: '2027-2028', periods: [4], sisuId: 'otm-2900b4a0-0e96-4086-8b08-63b4acdb6f49' },
  { code: 'CT60A9602', title: 'Functional programming', credits: 3, category: 'intermediate', studyYear: '2027-2028', periods: [4], sisuId: 'otm-d2e508a4-5976-4e19-8670-13681140c354' },
  { code: 'CT30A3401', title: 'Distributed Systems', credits: 6, category: 'intermediate', studyYear: '2028-2029', periods: [3, 4], sisuId: 'otm-f29c0f7e-a4e6-498a-b52b-1a7846f03a4d' },
  { code: 'CT60A4500', title: 'Fundamentals of Software Testing (Lahti)', credits: 3, category: 'intermediate', studyYear: '2027-2028', periods: [1], sisuId: 'otm-974b31f5-f9e9-4085-b8d2-df732f6401a7' },
  { code: 'CT60A4700', title: 'Advanced networks', credits: 3, category: 'intermediate', studyYear: '2027-2028', periods: [2], sisuId: 'otm-5f130b19-9121-462c-bc3a-7c9d46a890b2' },
  { code: 'CT30A3350', title: 'Operating Systems and System Programming (Lahti)', credits: 6, category: 'intermediate', studyYear: '2028-2029', periods: [3, 4], sisuId: 'otm-fca58a4e-5cb4-4716-a1d8-16b04f695db5' },
  { code: 'CT60A5540', title: 'Computer networks and Internet', credits: 3, category: 'intermediate', studyYear: '2027-2028', periods: [2], sisuId: 'otm-2edea6a6-0106-4f07-aadc-5749741411b7' },
  { code: 'CT30A2910', title: 'Introduction to Web Programming', credits: 3, category: 'intermediate', studyYear: '2028-2029', periods: [1], sisuId: 'otm-010a5b4e-8681-4bb7-91fb-e77c0a2ae6b6' },
  { code: 'CT60A4800', title: 'Fundamentals of smart systems', credits: 4, category: 'intermediate', studyYear: '2027-2028', periods: [1, 2], sisuId: 'otm-98933ecb-49ff-4bcc-98b2-ad5ee1f2d844' },
  { code: 'CT60A5511', title: 'Software Quality Management', credits: 3, category: 'intermediate', studyYear: '2027-2028', periods: [1], timingNote: 'SISU 2026–27 offers this online across the full year; PDF also mentions summer', sisuId: 'otm-d2c6ef67-5372-498b-921e-fe504029ad38' },
  { code: 'CT60A5522', title: 'Cyber Security of Software Systems', credits: 3, category: 'intermediate', studyYear: '2027-2028', periods: [3, 4], sisuId: 'otm-aa0a198f-4f60-4ab6-ab3d-c8940fef59a3' },
  { code: 'CT60A4350', title: 'Basics of Database Systems (Lahti)', credits: 3, category: 'intermediate', studyYear: '2027-2028', periods: [3], sisuId: 'otm-029bbd21-90e2-4dce-9320-7d8e0b989292' },
  { code: 'CT60A7660', title: 'Database Systems Management (Lahti)', credits: 3, category: 'intermediate', studyYear: '2027-2028', periods: [4], sisuId: 'otm-034eb71b-bb55-4908-9410-dcd3f8bba418' },
  { code: 'CT60A9800', title: 'Capstone Project for Software and Systems Engineering', credits: 9, category: 'intermediate', studyYear: '2028-2029', periods: [3, 4], sisuId: 'otm-4d71a569-0d91-450f-8c31-236021115338' },
  { code: 'HDD5010', title: 'Foundations of Computer Science (HDD)', credits: 6, category: 'intermediate', studyYear: '2026-2027', periods: [3, 4], sisuId: 'otm-23f71ebe-e11c-4c4a-a00d-4ea56c2b3445' },
  { code: 'HDD5020', title: 'Foundations of Information Processing (HDD)', credits: 6, category: 'intermediate', studyYear: '2026-2027', periods: [1, 2], sisuId: 'otm-b54cd883-8e4a-471a-927f-436da10dae2f' },
  { code: 'HDD5030', title: 'Data Structures and Algorithms (HDD)', credits: 6, category: 'intermediate', studyYear: '2027-2028', periods: [1, 2], sisuId: 'otm-a9ee0621-f573-43b4-8eaa-88401c4d40a5' },
  { code: 'HDD5040', title: 'Foundations of Artificial Intelligence and Machine Learning (HDD)', credits: 6, category: 'intermediate', studyYear: '2028-2029', periods: [1, 2], sisuId: 'otm-ea6a947b-986f-4daf-8276-584392eae81e' },
  { code: 'CT10A5000', title: "Bachelor's Thesis and Seminar, SSE", credits: 12, category: 'intermediate', studyYear: '2028-2029', periods: [1, 2], sisuId: 'otm-3896cbb3-d407-4665-aefe-e630163cce6a' },
  { code: 'LUTKYPSAT', title: "Maturity test in Bachelor's Degree", credits: 0, category: 'intermediate', studyYear: '2028-2029', periods: [1, 2, 3, 4], sisuId: 'otm-e9a8bac7-974e-471f-be4f-4b18279c2908' },
  { code: 'HDD5000', title: "HEBUT Bachelor's Thesis Seminar, SSE (HDD)", credits: 0, category: 'intermediate', studyYear: '2028-2029', periods: [3, 4], sisuId: 'otm-3a261197-8a8b-4f06-910b-2228cd71493f' },

  // Minor studies — 31 / min 20 (8 completed)
  { code: 'BH60A6200', title: 'Sustainable Cities', credits: 6, category: 'minor', studyYear: '2028-2029', periods: [1, 2], sisuId: 'otm-2cd9497b-4e65-426c-87a1-5a4f8838b897' },
  { code: 'BH60A6802', title: 'Sustainable.now', credits: 3, creditRange: { min: 3, max: 5 }, category: 'minor', studyYear: '2027-2028', periods: [4], timingNote: 'SISU offers 3 or 5 cr in P2/P4; 2028–29 P4 is an alternative', sisuId: 'otm-5084627d-9008-44d4-9800-11a7789d9c49' },
  { code: 'BH60A7201', title: 'Circular.now', credits: 3, category: 'minor', studyYear: '2027-2028', periods: [3], sisuId: 'otm-f97f4481-8cf1-4b93-9a53-da9d021648e7' },
  ...['A', 'B', 'C', 'D'].map((suffix, index): PersonalPlanCourse => ({
    code: `MOOC0002${suffix}`,
    title: `Climate Action – Power to X Module ${index + 1}`,
    credits: 0.5,
    category: 'minor',
    completed: true,
    grade: 'pass',
    sisuId: ['otm-77ddee14-75e6-4553-b018-ac95f7b17160', 'otm-203bb15a-b784-4b60-956a-10996aee689f', 'otm-06594baa-eb1a-47f2-bf79-8ee2a5a1a848', 'otm-965d1b08-b223-4282-a68d-918eb9e7a09a'][index],
    ...moocGroup('mooc-power-to-x', 'Climate Action – Power to X'),
  })),
  ...['A', 'B', 'C', 'D'].map((suffix, index): PersonalPlanCourse => ({
    code: `MOOC0001${suffix}`,
    title: `Climate Action – Solutions for Carbon Neutral Transport Module ${index + 1}`,
    credits: 0.5,
    category: 'minor',
    completed: true,
    grade: 'pass',
    sisuId: ['otm-3fb6c893-6b9b-436f-b77d-3012857fc360', 'otm-b99093be-6f9d-454e-ac0b-404d770e54fd', 'otm-561674e7-ab78-44d0-a705-89bd1bb2c1e3', 'otm-ea417b8b-554a-47db-8777-47bd8c524199'][index],
    ...moocGroup('mooc-carbon-neutral-transport', 'Climate Action – Solutions for Carbon Neutral Transport'),
  })),
  ...['A', 'B', 'C', 'D'].map((suffix, index): PersonalPlanCourse => ({
    code: `MOOC0003${suffix}`,
    title: `Climate Action – Sustainable design and production Module ${index + 1}`,
    credits: 0.5,
    category: 'minor',
    completed: true,
    grade: 'pass',
    sisuId: ['otm-19e6b014-d84c-4d82-85ce-a304fa64051b', 'otm-8026c873-e89c-4258-b0d1-da34826694ff', 'otm-ea695272-7fac-4269-bd4f-b3fabd97d343', 'otm-2ca02aab-0e7d-4088-ace6-d4a5e67e820a'][index],
    ...moocGroup('mooc-sustainable-design', 'Climate Action – Sustainable design and production'),
  })),
  { code: 'BH60A7400', title: 'Climate.Now', credits: 2, category: 'minor', studyYear: '2027-2028', periods: [3, 4], sisuId: 'otm-2accc318-71f2-45e7-ae90-94cfbc85140d' },
  { code: 'BH60A7410', title: 'Introduction to Life Cycle Thinking and Assessment', credits: 3, category: 'minor', studyYear: '2027-2028', periods: [1], sisuId: 'otm-215ad51d-4a61-4d4e-a426-747177919312' },
  { code: 'BH60A7500', title: 'Impact Entrepreneurship', credits: 6, category: 'minor', studyYear: '2027-2028', periods: [2], sisuId: 'otm-765d7d98-aa0c-45fd-bb30-89f50427aaa5' },
  { code: 'MOOC0005A', title: 'Climate Action – The role of Digital Transformation in the Process Industry', credits: 2, category: 'minor', completed: true, grade: 'pass', sisuId: 'otm-2fe324c9-48ea-4717-b255-5bb4ce17d072' },

  // Elective studies — 25 / min 0 (2 completed)
  { code: 'MOOC0006B', title: 'Basics of technical calculation and engineering mechanics Module 2: Matlab basics', credits: 2, category: 'elective', studyYear: '2026-2027', periods: [1], sisuId: 'otm-d029f2ec-1d07-4c6d-8c48-0efcc9abd8a1', ...moocGroup('mooc-technical-calculation', 'Basics of technical calculation and engineering mechanics') },
  { code: 'MOOC0006D', title: 'Basics of technical calculation and engineering mechanics Module 4: Basics of FEM', credits: 2, category: 'elective', studyYear: '2026-2027', periods: [1], sisuId: 'otm-7438b987-7922-4322-9da3-596dd086b990', ...moocGroup('mooc-technical-calculation', 'Basics of technical calculation and engineering mechanics') },
  { code: 'MOOC0006A', title: 'Basics of technical calculation and engineering mechanics Module 1: Basics of Technical Mathematics', credits: 2, category: 'elective', studyYear: '2026-2027', periods: [1], sisuId: 'otm-19bcd836-8c4c-4d03-bbc1-139466abcab5', ...moocGroup('mooc-technical-calculation', 'Basics of technical calculation and engineering mechanics') },
  { code: 'MOOC0004A', title: 'Introduction to sustainable 3D-modeling', credits: 1, category: 'elective', studyYear: '2026-2027', periods: [3, 4], sisuId: 'otm-d362fae9-aaed-4c32-9e2d-258f44ad15f0' },
  { code: 'HDD4020', title: 'Engineering Mathematics II (HDD)', credits: 3, category: 'elective', studyYear: '2027-2028', periods: [1, 2], sisuId: 'otm-226958b1-51ac-41e3-a9a8-921a44a164aa' },
  { code: 'HDD4030', title: 'Engineering Mathematics III (HDD)', credits: 3, category: 'elective', studyYear: '2026-2027', periods: [1], sisuId: 'otm-8a50887c-7841-44d0-a4dc-0ca2e23c85fb' },
  { code: 'MOOC0006C', title: 'Basics of technical calculation and engineering mechanics Module 3: Applied Matlab', credits: 2, category: 'elective', studyYear: '2026-2027', periods: [1], timingNote: 'PDF does not list a period for this module; grouped with the P1 module block', sisuId: 'otm-ce302a7d-7a80-4f69-a8f3-9534101a7c30', ...moocGroup('mooc-technical-calculation', 'Basics of technical calculation and engineering mechanics') },
  { code: 'HDD4010', title: 'Engineering Mathematics I (HDD)', credits: 3, category: 'elective', timingNote: 'PDF does not give planned timing; SISU 2026–27 offers it in P1', sisuId: 'otm-a6551246-0e24-450b-8729-11bee865ac3b' },
  { code: 'HDD4040', title: 'Engineering Mathematics IV (HDD)', credits: 3, category: 'elective', timingNote: 'PDF does not give planned timing; SISU 2026–27 offers it in P4', sisuId: 'otm-ab515331-921d-4b2a-b4d2-fa647393d14a' },
  { code: 'MOOC0006E', title: 'Basics of technical calculation and engineering mechanics Module 5: Basics of Mechanics', credits: 2, category: 'elective', studyYear: '2026-2027', periods: [1], timingNote: 'PDF does not list a period for this module; grouped with the P1 module block', sisuId: 'otm-2e22a452-3ef4-4873-b668-5f6e0c987a03', ...moocGroup('mooc-technical-calculation', 'Basics of technical calculation and engineering mechanics') },
  { code: 'MOOC0005B', title: 'Polyester production for the textile industry: Transitioning from fossil fuels to sustainable alternatives', credits: 2, category: 'elective', completed: true, grade: 'pass', sisuId: 'otm-e815af45-9afb-40f8-b792-09dd3341269a' },
] as const

/** Deterministic plan items for first-run seeding. */
export function personalPlanItems(): SisuPlanItem[] {
  return PERSONAL_PLAN_COURSES.map((course) => ({
    id: `sisu:${course.code}`,
    kind: course.credits === 0 && course.code === 'LUTKYPSAT' ? 'milestone' : 'course',
    title: course.title,
    courseCode: course.code,
    credits: course.credits,
    creditRange: course.creditRange,
    studyYear: course.studyYear,
    periods: course.periods,
    category: course.category,
    groupKey: course.groupKey,
    groupTitle: course.groupTitle,
    sisuId: course.sisuId,
    timingNote: course.timingNote,
    grade: course.grade,
    completed: course.completed === true,
    createdAt: '2026-08-20T00:00:00.000Z',
    timingSource: 'pdf-plan',
  }))
}

export function personalPlanCourse(code: string): PersonalPlanCourse | undefined {
  return PERSONAL_PLAN_COURSES.find((course) => course.code === code)
}

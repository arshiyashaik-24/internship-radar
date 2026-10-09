// Vocabulary used to classify vacancies. Editing these lists changes how roles are
// tagged; it never invents data that is not in the vacancy text.

export const FIELDS = [
  {
    id: 'ai_ml_cv',
    label: 'AI / ML / Computer Vision',
    patterns: [/\bmachine[- ]learning\b/i, /\bdeep[- ]learning\b/i, /\bcomputer[- ]vision\b/i, /\bneural\s+net/i, /\bpytorch\b/i, /\btensorflow\b/i, /\bjax\b/i, /\bAI\b/, /\bartificial intelligence\b/i, /\bLLMs?\b/, /\blarge language model/i, /\bimage (?:processing|analysis|recognition|segmentation)\b/i, /\bcomputational imaging\b/i, /\breinforcement learning\b/i, /\bML\b/, /\bgenerative\b/i, /\bperception\b/i],
  },
  {
    id: 'quantum',
    label: 'Quantum Computing',
    patterns: [/\bquantum\b/i, /\bqubits?\b/i, /\bsuperconducting\b/i, /\btrapped[- ]ions?\b/i, /\bquantum error correction\b/i, /\bqiskit\b/i, /\bcirq\b/i, /\bcryogenic/i],
  },
  {
    id: 'robotics',
    label: 'Robotics / Autonomous Systems',
    patterns: [/\brobot(?:s|ic|ics)?\b/i, /\bautonomous\b/i, /\bautonomy\b/i, /\bROS2?\b/, /\bSLAM\b/, /\bmotion planning\b/i, /\bmechatronic/i, /\bdrones?\b/i, /\bself[- ]driving\b/i, /\bcontrol systems?\b/i, /\bwarehouse automation\b/i],
  },
  {
    id: 'semiconductors_hw',
    label: 'Semiconductors / Hardware',
    patterns: [/\bsemiconductors?\b/i, /\bchips?\b/i, /\bASICs?\b/, /\bFPGAs?\b/, /\bVLSI\b/, /\bRTL\b/, /\bverilog\b/i, /\bVHDL\b/, /\blithograph/i, /\bwafers?\b/i, /\banalog(?:ue)? design\b/i, /\bhardware\b/i, /\bPCBs?\b/, /\belectronics?\b/i, /\bIC design\b/i, /\bmixed[- ]signal\b/i],
  },
  {
    id: 'comp_physics',
    label: 'Computational Physics / Scientific R&D',
    patterns: [/\bphysic(?:s|ist|al modelling)\b/i, /\bnumerical\b/i, /\bsimulations?\b/i, /\bscientific computing\b/i, /\bcomputational\b/i, /\bfinite[- ]element/i, /\boptic(?:s|al)\b/i, /\bphotonic/i, /\bmicroscop/i, /\bmetrology\b/i, /\binstrumentation\b/i, /\bplasma\b/i, /\bfusion\b/i, /\blasers?\b/i, /\bspectroscop/i, /\bR&D\b/],
  },
  {
    id: 'embedded_iot',
    label: 'Embedded Systems / IoT',
    patterns: [/\bembedded\b/i, /\bfirmware\b/i, /\bmicrocontroller/i, /\bRTOS\b/, /\bIoT\b/, /\binternet of things\b/i, /\bsensors?\b/i, /\breal[- ]time\b/i, /\bbare[- ]metal\b/i, /\bARM Cortex\b/i],
  },
  {
    id: 'data_quant',
    label: 'Data Science / Quantitative Research',
    patterns: [/\bdata scien/i, /\bquantitative\b/i, /\bquant\b/i, /\bstatistic/i, /\btrading\b/i, /\btraders?\b/i, /\banalytics\b/i, /\bapplied math/i, /\bmathemati/i, /\beconometric/i, /\bprobabilit/i, /\bdata engineer/i],
  },
  {
    id: 'medical_imaging',
    label: 'Medical Imaging / Biomedical Technology',
    patterns: [/\bmedical imaging\b/i, /\bMRI\b/, /\bCT\b/, /\bultrasound\b/i, /\bx[- ]ray\b/i, /\bbiomedical\b/i, /\bhealthcare\b/i, /\bclinical\b/i, /\bradiolog/i, /\bmedical devices?\b/i, /\bpatholog/i, /\bhealth ?tech/i],
  },
  {
    id: 'software',
    label: 'Software Engineering / Algorithms',
    patterns: [/\bsoftware\b/i, /\bdevelopers?\b/i, /\balgorithm/i, /\bback[- ]?end\b/i, /\bsystems programming\b/i, /\bdistributed systems\b/i, /\bcompilers?\b/i, /\bC\+\+/, /\brust\b/i, /\bjava\b/i, /\bprogramming\b/i, /\bfull[- ]stack\b/i, /\bfront[- ]?end\b/i],
  },
];

export const FIELD_LABELS = Object.fromEntries(FIELDS.map((f) => [f.id, f.label]));

// Pairs that the brief asks to rank higher: computer science combined with
// physics, ML, imaging, robotics, quantum or hardware.
export const COMBO_FIELDS = ['comp_physics', 'ai_ml_cv', 'medical_imaging', 'robotics', 'quantum', 'semiconductors_hw'];
export const CS_FIELDS = ['software', 'ai_ml_cv', 'data_quant', 'embedded_iot'];

export const SKILLS = [
  ['Python', /\bpython\b/i], ['C++', /\bC\+\+/], ['Java', /\bjava\b(?!script)/i],
  ['Rust', /\brust\b/i], ['Go', /\bGolang\b|\bGo\b(?= (?:or|and|,))/], ['MATLAB', /\bmatlab\b/i], ['Julia', /\bjulia\b/i],
  ['PyTorch', /\bpytorch\b/i], ['TensorFlow', /\btensorflow\b/i], ['JAX', /\bjax\b/i], ['scikit-learn', /\bscikit[- ]learn|sklearn\b/i],
  ['OpenCV', /\bopencv\b/i], ['NumPy', /\bnumpy\b/i], ['pandas', /\bpandas\b/i], ['ROS', /\bROS2?\b/],
  ['Linux', /\blinux\b/i], ['Git', /\bgit\b/i], ['SQL', /\bSQL\b/], ['Verilog', /\bverilog\b/i], ['VHDL', /\bVHDL\b/],
  ['CUDA', /\bCUDA\b/], ['Docker', /\bdocker\b/i], ['Kubernetes', /\bkubernetes\b/i], ['JavaScript', /\bjavascript\b/i],
  ['TypeScript', /\btypescript\b/i], ['LabVIEW', /\blabview\b/i], ['COMSOL', /\bcomsol\b/i], ['Qiskit', /\bqiskit\b/i],
  ['Simulink', /\bsimulink\b/i], ['Embedded C', /\bembedded C\b/i], ['Image processing', /\bimage processing\b/i],
  ['Computer vision', /\bcomputer vision\b/i], ['Machine learning', /\bmachine learning\b/i], ['Statistics', /\bstatistics\b/i],
  ['Linear algebra', /\blinear algebra\b/i], ['Signal processing', /\bsignal processing\b/i], ['Control theory', /\bcontrol theory\b/i],
];

// Places used to judge location compatibility. Brainport is the Eindhoven region.
export const BRAINPORT = ['eindhoven', 'veldhoven', 'helmond', 'best', 'son en breugel', 'nuenen', 'waalre', 'geldrop', 'mierlo', 'valkenswaard', 'oirschot', 'deurne', 'brainport'];
export const NL_PLACES = [
  ...BRAINPORT, 'amsterdam', 'delft', 'rotterdam', 'utrecht', 'leiden', 'nijmegen', 'groningen', 'the hague', 'den haag', "'s-gravenhage",
  'enschede', 'wageningen', 'maastricht', 'haarlem', 'amersfoort', 'zwolle', 'arnhem', 'hilversum', 'schiphol', 'hoofddorp',
  'amstelveen', 'noordwijk', 'petten', 'breda', 'tilburg', "'s-hertogenbosch", 'den bosch', 'venlo', 'zoetermeer', 'almere', 'apeldoorn',
  'netherlands', 'nederland', 'holland',
];
export const EUROPE = [
  'europe', 'european union', 'emea', 'eea', 'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech', 'denmark', 'estonia', 'finland',
  'france', 'germany', 'greece', 'hungary', 'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'poland', 'portugal',
  'romania', 'slovakia', 'slovenia', 'spain', 'sweden', 'switzerland', 'norway', 'united kingdom', 'uk', 'london', 'paris', 'berlin',
  'munich', 'zurich', 'geneva', 'dublin', 'madrid', 'barcelona', 'milan', 'stockholm', 'copenhagen', 'brussels', 'leuven', 'antwerp',
  'vienna', 'warsaw', 'prague', 'lisbon', 'aarhus', 'cambridge', 'oxford', 'edinburgh', 'helsinki', 'oslo', 'belgrade',
];
// Countries/cities outside Europe that commonly appear in location strings.
export const NON_EUROPE = [
  'united states', 'usa', 'us', 'u.s.', 'canada', 'india', 'china', 'shanghai', 'hong kong', 'singapore', 'japan', 'tokyo', 'australia',
  'sydney', 'new york', 'chicago', 'austin', 'san francisco', 'seattle', 'boston', 'mountain view', 'santa clara', 'bellevue', 'texas',
  'california', 'colorado', 'broomfield', 'taiwan', 'korea', 'israel', 'brazil', 'mexico', 'kuala lumpur', 'malaysia', 'apac', 'americas',
];

export const EMPLOYMENT_TYPES = {
  internship: 'Internship',
  research: 'Research internship / assistant',
  working_student: 'Working student / part-time',
  thesis: 'Thesis or graduation project',
  talent_pool: 'Programme interest form',
  other: 'Other student role',
};

export const ELIGIBILITY_LABELS = {
  eligible: 'Eligible based on published requirements',
  potential: 'Potentially eligible — verify with employer',
  future: 'Future eligibility — does not meet stated requirements yet',
  ineligible: 'Ineligible based on a confirmed requirement',
  unknown: 'Eligibility unknown',
};

const TYPE_GROUPS = {
  thin: ['thin_1', 'thin_2', 'thin_3', 'thin_4'],
  thick: ['thick_1', 'thick_2'],
  special: ['special_1'],
};

const TYPE_LABELS = {
  thin_1: 'เศษลวดหัวแบ่ง',
  thin_2: 'สายแพ็คเหล็ก',
  thin_3: 'เศษลวดปลอก',
  thin_4: 'ลวดผูกเหล็กรัดลวดปลอก',
  thick_1: 'เศษเหล็กโดเวล',
  thick_2: 'เหล็กรูปพรรณเศษชิ้นส่วนเครื่องจักร/เศษเหล็กเพลท',
  special_1: 'เศษเหล็กแผ่นจากการตัดเพลทเครื่องตัดพลาสม่า',
};

const GROUP_LABELS = {
  thin: 'เหล็กบาง',
  thick: 'เหล็กหนา',
  special: 'เหล็กหนาพิเศษ',
};

module.exports = {
  TYPE_GROUPS,
  TYPE_LABELS,
  GROUP_LABELS,
};

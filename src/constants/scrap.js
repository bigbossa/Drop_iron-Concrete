const TYPE_GROUPS = {
  thin: ['thin_1', 'thin_2', 'thin_3', 'thin_4'],
  thick: ['thick_1', 'thick_2'],
  special: ['special_1'],
  concrete_general: [
    'concrete_plant',
    'concrete_factory_product_test',
    'concrete_site_defect',
    'concrete_wrong_spec',
    'concrete_transfer',
    'concrete_site',
    'concrete_structure',
  ],
  concrete_quality: ['concrete_cube', 'concrete_sludge', 'concrete_grind'],
};

const TYPE_LABELS = {
  thin_1: 'เศษลวดหัวแบ่ง(PCY)',
  thin_2: 'สายแพ็คเหล็ก',
  thin_3: 'เศษลวดปลอก',
  thin_4: 'ลวดผูกเหล็กรัดลวดปลอก',
  thick_1: 'เศษเหล็กโดเวล',
  thick_2: 'เหล็กรูปพรรณเศษชิ้นส่วนเครื่องจักร/เศษเหล็กเพลท',
  special_1: 'เศษเหล็กแผ่นจากการตัดเพลทเครื่องตัดพลาสม่า',
  concrete_plant: 'เศษคอนกรีตจากโรงงานผลิต',
  concrete_factory_product_test: 'เศษผลิตภัณฑ์รีเจค ในโรงงานและเศษจากผลิตภัณฑ์ที่ทำการทดสอบ เทส ',
  concrete_site_defect: 'เศษผลิตภัณฑ์รีเจค หน้างาน ',
  concrete_wrong_spec: 'เศษผลิตภัณฑ์ที่ตัดแปรสภาพ',
  concrete_transfer: 'เศษคอนกรีตระหว่างขนส่งและลำเลียง',
  concrete_site: 'เศษคอนกรีตบริเวณหน้างาน',
  concrete_structure: 'เศษคอนกรีตจากงานรื้อ/ซ่อมโครงสร้าง',
  concrete_cube: 'ลูกปูนแพล้น',
  concrete_sludge: 'เศษงานสลัดจ์',
  concrete_grind: 'เศษงานเรดีมิกซ์',
};

const GROUP_LABELS = {
  thin: 'เหล็กบาง',
  thick: 'เหล็กหนา',
  special: 'เหล็กหนาพิเศษ',
  concrete_general: 'ประเภทเศษคอนกรีต',
  concrete_quality: 'ประเภทเศษคอนกรีต',
};

module.exports = {
  TYPE_GROUPS,
  TYPE_LABELS,
  GROUP_LABELS,
};

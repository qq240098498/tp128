// 换算历史：负责三件事——把每次换算连同当时的档案状态指纹存成快照；
// 判定上一次换算是否已经过期；登记档案的增删改，供过期说明指出是哪条档案、什么时候动的
const crypto = require('crypto');
const { load, save } = require('./store');
const { computeConversion } = require('./convert');

// 真正进入换算结果的档案字段：id 决定在不在范围与排序，其余四项直接出现在结果里。
// 备注、夏令时偏移与切换规则、生效年份都不参与当前口径的换算，改了它们不算结果过期
const FINGERPRINT_FIELDS = ['id', 'name', 'displayName', 'offsetMinutes', 'usesDst'];

// 单条档案的结果指纹：字段顺序固定，值统一走 JSON 转义，名称里有特殊字符也不会串
function zoneResultFingerprint(zone) {
  return JSON.stringify(FINGERPRINT_FIELDS.map((field) => zone[field]));
}

// 整份档案状态的指纹：按指纹行排序后哈希，与档案在文件里的先后无关
function registryFingerprint(zones) {
  const lines = zones.map(zoneResultFingerprint).sort().join('\n');
  return crypto.createHash('sha256').update(lines, 'utf8').digest('hex');
}

// 修改前后对比：只有结果相关字段动过才算会影响结果，只改备注时返回空表
function changedResultFields(before, after) {
  return FINGERPRINT_FIELDS.filter((field) => before[field] !== after[field]);
}

// 在待保存的数据上追加一条变更，落盘前的截断由 store 统一做
function appendChange(data, entry) {
  if (!Array.isArray(data.zoneChanges)) data.zoneChanges = [];
  data.zoneChanges.push({ fields: [], affectsResult: true, ...entry });
}

// 换算一遍：算完把输入、结果本体、档案指纹与换算时刻存为最新快照
function runConvert(options) {
  const data = load();
  const result = computeConversion(options, data);
  const convertedAt = new Date().toISOString();
  data.lastConvert = {
    input: {
      date: result.input.date,
      time: result.input.time,
      zoneId: result.input.zoneId,
    },
    fingerprint: registryFingerprint(data.zones),
    convertedAt,
    result,
  };
  save(data);
  return presentLast(data);
}

// 找出快照之后真正影响结果的档案变更：备注类（affectsResult 为假）直接跳过
function collectStaleChanges(data) {
  const snap = data.lastConvert;
  return (data.zoneChanges || [])
    .filter((item) => item.affectsResult && item.changedAt >= snap.convertedAt)
    .map((item) => ({
      action: item.action,
      zoneId: item.zoneId,
      zoneName: item.zoneName,
      changedAt: item.changedAt,
      fields: item.fields,
    }));
}

// 给页面的完整形态：结果本体照原样给，另附换算时刻与过期判定
function presentLast(data) {
  const snap = data.lastConvert;
  if (!snap) return null;
  const stale = registryFingerprint(data.zones) !== snap.fingerprint;
  return {
    ...snap.result,
    convertedAt: snap.convertedAt,
    stale,
    // 指纹不一致但日志里查不到对应变更（例如数据文件被直接改过）时，过期标记照样保留
    staleChanges: stale ? collectStaleChanges(data) : [],
  };
}

function getLastConvert() {
  return presentLast(load());
}

module.exports = {
  FINGERPRINT_FIELDS,
  registryFingerprint,
  changedResultFields,
  appendChange,
  runConvert,
  getLastConvert,
};

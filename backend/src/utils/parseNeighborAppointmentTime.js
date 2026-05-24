'use strict';

/**
 * 解析邻里帮帮预约时间：支持 ISO、时间戳、小程序 picker 中文格式
 * @returns {Date|null}
 */
function parseNeighborAppointmentTime(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(raw).trim();
  if (!s) return null;

  const ts = Date.parse(s);
  if (!Number.isNaN(ts)) return new Date(ts);

  const cn = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/);
  if (cn) {
    const d = new Date(
      parseInt(cn[1], 10),
      parseInt(cn[2], 10) - 1,
      parseInt(cn[3], 10),
      parseInt(cn[4], 10),
      parseInt(cn[5], 10),
      0
    );
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

module.exports = { parseNeighborAppointmentTime };

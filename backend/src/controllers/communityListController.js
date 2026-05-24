/** GET /core/communities、POST /core/communities/resolve */
const geofence = require('../services/communityGeofence.service');
const { Op } = require('sequelize');

module.exports.getCommunities = async (req, res) => {
  try {
    const db = require('../models');
    const Community = db.Community;
    if (!Community) {
      return res.status(501).json({ code: 1, msg: 'Community 模型未加载' });
    }

    // 解析查询参数
    const { city, keyword, page, page_size, latitude, longitude } = req.query;

    // 构建查询条件
    const where = { status: 'active' };

    // 按城市筛选
    if (city) {
      where.city = { [Op.like]: `%${city}%` };
    }

    // 按关键词搜索小区名称
    if (keyword) {
      where.name = { [Op.like]: `%${keyword}%` };
    }

    // 分页参数
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(page_size) || 20, 1), 100);
    const offset = (pageNum - 1) * pageSize;

    // 查询总数
    const totalCount = await Community.count({ where });

    // 查询小区列表
    const rows = await Community.findAll({
      where,
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      attributes: ['id', 'name', 'city', 'district', 'address', 'latitude', 'longitude'],
      limit: pageSize,
      offset
    });

    // 获取地理围栏信息
    const areas = await geofence.loadActiveAreas();
    const areaByComm = {};
    areas.forEach((a) => {
      if (!areaByComm[a.community_id]) areaByComm[a.community_id] = a;
    });

    // 构建响应列表
    let list = rows.map((r) => {
      const area = areaByComm[r.id];
      return {
        id: r.id,
        name: r.name,
        city: r.city,
        district: r.district,
        address: r.address,
        latitude: r.latitude,
        longitude: r.longitude,
        radius_meters: area ? area.radius_meters : null
      };
    });

    // 如果提供了坐标，按距离排序
    if (latitude && longitude) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        // 计算距离并排序
        list = list.map(item => {
          const itemLat = parseFloat(item.latitude);
          const itemLng = parseFloat(item.longitude);
          let distance = null;
          if (Number.isFinite(itemLat) && Number.isFinite(itemLng)) {
            // 使用 Haversine 公式计算距离
            const R = 6371000; // 地球半径（米）
            const dLat = (itemLat - lat) * Math.PI / 180;
            const dLng = (itemLng - lng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lat * Math.PI / 180) * Math.cos(itemLat * Math.PI / 180) *
                      Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distance = R * c;
          }
          return { ...item, distance };
        });

        // 按距离排序
        list.sort((a, b) => {
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
      }
    }

    return res.json({
      success: true,
      errno: 0,
      list,
      total: totalCount,
      page: pageNum,
      page_size: pageSize
    });
  } catch (err) {
    console.error('[getCommunities]', err);
    return res.status(500).json({ code: 1, msg: '服务器内部错误' });
  }
};

/** POST /core/communities/resolve — 根据坐标/选点文案解析小区 */
module.exports.resolveCommunity = async (req, res) => {
  try {
    const body = req.body || {};
    const hit = await geofence.resolveCommunityFromInput(body);
    if (!hit || hit.community_id == null) {
      return res.json({
        success: true,
        errno: 0,
        matched: false,
        community_id: null,
        msg: '当前位置不在已开通小区服务范围内'
      });
    }
    const db = require('../models');
    let name = '';
    if (db.Community) {
      const row = await db.Community.findByPk(hit.community_id, { attributes: ['id', 'name'] });
      name = row ? row.name : '';
    }
    return res.json({
      success: true,
      errno: 0,
      matched: true,
      community_id: hit.community_id,
      community_name: name,
      match_type: hit.match_type || null,
      distance_m: hit.distance_m != null ? hit.distance_m : null,
      center_name: hit.center_name || null
    });
  } catch (err) {
    console.error('[resolveCommunity]', err);
    return res.status(500).json({ code: 1, msg: '解析失败' });
  }
};

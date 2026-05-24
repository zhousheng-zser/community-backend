
require('dotenv').config();
const db = require('./src/models');
const svc = require('./src/modules/coupon/services/coupon.service');
const UID = '313949215099195408';
const codes = ['E2E_ALL_5','E2E_MKT_5','E2E_SVC_W','E2E_SVC_SP'];
(async () => {
  await svc.ensureCouponTables();
  const out = {};
  for (const code of codes) {
    const tpl = await db.CouponTemplate.findOne({ where: { code } });
    if (!tpl) throw new Error('missing template ' + code);
    const issue = await svc.issueToUser(UID, tpl.id, { source: 'e2e_test' });
    out[code] = { template_id: tpl.id, issue_id: issue.id };
  }
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });

import { createRouter, createWebHistory } from 'vue-router'
import Layout from '../layout/index.vue'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    component: Layout,
    redirect: '/dashboard',
    children: [
            { path: 'service-home-manage', name: 'ServiceHomeManage', component: () => import('../views/ServiceHomeManage.vue'), meta: { title: '服务管理' } },
      { path: 'dashboard', name: 'Dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '工作台' } },
      { path: 'user-management', name: 'UserManagement', component: () => import('../views/UserManagement.vue'), meta: { title: '用户管理' } },
      { path: 'ops-hub', name: 'OperationsHub', component: () => import('../views/OperationsHub.vue'), meta: { title: '运营快捷入口' } },
      { path: 'system-status', name: 'SystemStatus', component: () => import('../views/SystemStatus.vue'), meta: { title: '系统状态' } },
      { path: 'worker-applications', name: 'WorkerApplications', component: () => import('../views/WorkerApplications.vue'), meta: { title: '技工入驻' } },
      { path: 'service-providers', name: 'ServiceProviders', component: () => import('../views/ServiceProviders.vue'), meta: { title: '直约服务商管理' } },
      { path: 'service-provider-applications', name: 'ServiceProviderApplications', component: () => import('../views/ServiceProviderApplications.vue'), meta: { title: '服务商入驻' } },
      { path: 'home-service-dispatch', name: 'HomeServiceDispatch', component: () => import('../views/HomeServiceDispatch.vue'), meta: { title: '九州派单（到家+帮帮）' } },
      { path: 'home-display-config', name: 'HomeDisplayConfig', component: () => import('../views/HomeDisplayConfig.vue'), meta: { title: '首页管理' } },
      { path: 'market-applications', name: 'MarketApplications', component: () => import('../views/MarketApplications.vue'), meta: { title: '店铺入驻审核' } },
      { path: 'market-orders', name: 'MarketOrders', component: () => import('../views/MarketOrders.vue'), meta: { title: '订单' } },
      { path: 'order-fulfillment', name: 'OrderFulfillment', component: () => import('../views/OrderFulfillment.vue'), meta: { title: '订单履约' } },
      { path: 'market-payments', name: 'MarketPayments', component: () => import('../views/MarketPayments.vue'), meta: { title: '支付流水' } },
      { path: 'refund-center', name: 'RefundCenter', component: () => import('../views/RefundCenter.vue'), meta: { title: '退款中心' } },
      { path: 'settlement-center', name: 'SettlementCenter', component: () => import('../views/SettlementCenter.vue'), meta: { title: '结算中心' } },
      { path: 'market-shops', name: 'MarketShops', component: () => import('../views/MarketShops.vue'), meta: { title: '店铺' } },
      { path: 'merchant-accounts', name: 'MerchantAccounts', component: () => import('../views/MerchantAccounts.vue'), meta: { title: '商户账户' } },
      { path: 'complaint-tickets', name: 'ComplaintTickets', component: () => import('../views/ComplaintTickets.vue'), meta: { title: '投诉工单' } },
      { path: 'audit-logs', name: 'AuditLogs', component: () => import('../views/AuditLogs.vue'), meta: { title: '审计日志' } },
      { path: 'jd-benefit-goods', name: 'JdBenefitGoods', component: () => import('../views/JdBenefitGoods.vue'), meta: { title: '惠民卡·京东' } },
      { path: 'pdd-benefit-goods', name: 'PddBenefitGoods', component: () => import('../views/PddBenefitGoods.vue'), meta: { title: '惠民卡·拼多多' } },
      { path: 'benefit-display-config', name: 'BenefitDisplayConfig', component: () => import('../views/BenefitDisplayConfig.vue'), meta: { title: '惠民卡·运营位' } },
      { path: 'community-management', name: 'CommunityManagement', component: () => import('../views/CommunityManagement.vue'), meta: { title: '小区管理' } },
      { path: 'community-featured', name: 'CommunityFeatured', component: () => import('../views/CommunityFeatured.vue'), meta: { title: '小区管家精选' } },
      { path: 'coupon-center', name: 'CouponCenter', component: () => import('../views/CouponCenter.vue'), meta: { title: '券码中心' } },
      { path: 'local-goods-home-ui-assets', name: 'LocalGoodsHomeUiAssets', component: () => import('../views/LocalGoodsHomeUiAssets.vue'), meta: { title: '本地商城运营图' } },
      { path: 'local-goods-home-config', redirect: '/local-goods-home/hot_zone' },
      { path: 'local-goods-home/:listKey', name: 'LocalGoodsHomeConfig', component: () => import('../views/LocalGoodsHomeConfig.vue'), meta: { title: '本地商城榜单' } },
      { path: 'finance', name: 'Finance', component: () => import('../views/Finance.vue'), meta: { title: '提现审核（演示）' } },
      { path: 'message-center', name: 'MessageCenter', component: () => import('../views/MessageCenter.vue'), meta: { title: '消息中心' } },
      { path: 'customer-service', name: 'CustomerService', component: () => import('../views/CustomerService.vue'), meta: { title: '客服工作台' } }
    ]
  }
]

const router = createRouter({ history: createWebHistory(), routes })
router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('admin_token')
  if (to.meta.public) {
    if (token && to.path === '/login') {
      const r = to.query.redirect
      next(typeof r === 'string' && r ? r : '/dashboard')
    } else {
      next()
    }
    return
  }
  if (!token) {
    next({ path: '/login', query: { redirect: to.fullPath } })
    return
  }
  next()
})

export default router

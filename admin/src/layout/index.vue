<template>
  <el-container class="layout-container">
    <el-aside width="230px" class="aside">
      <div class="logo">
        <h2>九州社区 · 运营中台</h2>
      </div>
      <el-menu
        :default-active="$route.path"
        class="el-menu-vertical"
        background-color="#1e222d"
        text-color="#a3b1c6"
        active-text-color="#cda05b"
        router
      >
        <!-- 与小程序 Tab 对齐：首页 / 本地集市 / 惠民卡 / 本地商城 -->
        <el-sub-menu index="tab-home">
          <template #title>
            <el-icon><House /></el-icon>
            <span>首页</span>
          </template>
        <el-menu-item index="/dashboard">工作台</el-menu-item>
          <el-menu-item index="/user-management">用户管理</el-menu-item>
          <el-menu-item index="/ops-hub">运营快捷入口</el-menu-item>
          <el-menu-item index="/system-status">系统状态</el-menu-item>
          <el-menu-item index="/worker-applications">技工入驻</el-menu-item>
                  <el-menu-item index="/service-providers">直约服务商管理</el-menu-item>
        <el-menu-item index="/service-provider-applications">服务商入驻</el-menu-item>
          <el-menu-item index="/market-applications">店铺入驻审核</el-menu-item>
          <el-menu-item index="/home-service-dispatch">九州派单（到家+帮帮）</el-menu-item>
          <el-menu-item index="/home-display-config">首页管理</el-menu-item>
          <el-menu-item index="/service-home-manage">服务管理</el-menu-item>
          <el-menu-item index="/community-management">小区管理</el-menu-item>
          <el-menu-item index="/community-featured">管家精选</el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="tab-market">
          <template #title>
            <el-icon><Shop /></el-icon>
            <span>本地集市</span>
          </template>
          <el-menu-item index="/market-orders">订单</el-menu-item>
          <el-menu-item index="/order-fulfillment">订单履约</el-menu-item>
          <el-menu-item index="/market-payments">支付流水</el-menu-item>
          <el-menu-item index="/refund-center">退款中心</el-menu-item>
          <el-menu-item index="/settlement-center">结算中心</el-menu-item>
          <el-menu-item index="/market-shops">店铺</el-menu-item>
          <el-menu-item index="/merchant-accounts">商户账户</el-menu-item>
          <el-menu-item index="/complaint-tickets">投诉工单</el-menu-item>
          <el-menu-item index="/audit-logs">审计日志</el-menu-item>
          <el-menu-item index="/finance">提现审核（演示）</el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="tab-benefit">
          <template #title>
            <el-icon><Ticket /></el-icon>
            <span>惠民卡</span>
          </template>
          <el-menu-item index="/jd-benefit-goods">惠民卡·京东</el-menu-item>
          <el-menu-item index="/pdd-benefit-goods">惠民卡·拼多多</el-menu-item>
          <el-menu-item index="/benefit-display-config">惠民卡·运营位</el-menu-item>
          <el-menu-item index="/coupon-center">券码中心</el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="tab-local-goods">
          <template #title>
            <el-icon><ShoppingBag /></el-icon>
            <span>本地商城</span>
          </template>
          <el-menu-item index="/local-goods-home-ui-assets">00 首页运营图（8张）</el-menu-item>
          <el-menu-item v-for="item in localGoodsLinks" :key="item.key" :index="`/local-goods-home/${item.key}`">
            {{ item.name }}
          </el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="tab-cs-msg">
          <template #title>
            <el-icon><ChatDotRound /></el-icon>
            <span>客服与消息</span>
          </template>
          <el-menu-item index="/customer-service">客服工作台</el-menu-item>
          <el-menu-item index="/message-center">消息中心</el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-left">
          <h3>{{ $route.meta.title }}</h3>
        </div>
        <div class="header-right">
          <el-dropdown @command="onUserCommand">
            <span class="el-dropdown-link">
              {{ adminName }} <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main-body">
        <div class="page-router-wrap">
          <router-view />
        </div>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { House, Shop, Ticket, ShoppingBag, ChatDotRound, ArrowDown } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const router = useRouter()
const adminName = ref('管理员')
const localGoodsLinks = [
  { key: 'hot_zone', name: '01 爆款专区' },
  { key: 'gift_zone_all', name: '02 礼物专区（全量）' },
  { key: 'gift_elder', name: '03 礼物专区 > 送长辈' },
  { key: 'gift_friend', name: '04 礼物专区 > 送朋友' },
  { key: 'gift_colleague', name: '05 礼物专区 > 送同事' },
  { key: 'gift_partner', name: '06 礼物专区 > 送伴侣' },
  { key: 'pick_zone_all', name: '07 本地商城甄选（全量）' },
  { key: 'pick_food', name: '08 商城甄选 > 食品生鲜' },
  { key: 'pick_home', name: '09 商城甄选 > 家居百货' },
  { key: 'pick_beauty', name: '10 商城甄选 > 美妆洗护' },
  { key: 'pick_fashion', name: '11 商城甄选 > 服装箱包' },
  { key: 'pick_digital', name: '12 商城甄选 > 数码配件' },
  { key: 'pick_mother', name: '13 商城甄选 > 母婴系列' },
  { key: 'pick_craft', name: '14 商城甄选 > 传统工艺' },
  { key: 'pick_other', name: '15 商城甄选 > 其他' },
  { key: 'high_comm_zone', name: '16 高佣专区' },
  { key: 'brand_goods', name: '17 品牌好货' },
  { key: 'jiuzhou_haoshi', name: '18 九州好食' },
  { key: 'jiuzhou_haowu', name: '19 九州好物' },
  { key: 'jiuzhou_haowei', name: '20 九州好味' },
  { key: 'autumn_winter', name: '21 秋冬好物' },
  { key: 'daily_news', name: '22 每日上新（首页）' },
  { key: 'top_sales', name: '23 热卖TOP榜（首页）' },
  { key: 'periodic_today', name: '24 周期榜单 > 今日主推' },
  { key: 'periodic_weekly', name: '25 周期榜单 > 本周甄选' },
  { key: 'feed_high_comm_first', name: '26 Feed > 高佣推荐（首屏）' },
  { key: 'feed_hot_shop_first', name: '27 Feed > 热门好店（首屏）' },
  { key: 'feed_you_like_first', name: '28 Feed > 你可能喜欢（首屏）' },
  { key: 'feed_high_comm_paged', name: '29 Feed > 高佣推荐（翻页）' },
  { key: 'feed_hot_shop_paged', name: '30 Feed > 热门好店（翻页）' },
  { key: 'feed_you_like_paged', name: '31 Feed > 你可能喜欢（翻页）' }
]

onMounted(() => {
    try {
        const t = localStorage.getItem('admin_token')
        if (t) {
            const payload = JSON.parse(atob(t.split('.')[1]))
            if (payload && payload.sub) adminName.value = payload.sub
        }
    } catch (_) {
        /* ignore */
    }
})

function onUserCommand(cmd) {
    if (cmd === 'logout') {
        localStorage.removeItem('admin_token')
        ElMessage.success('已退出')
        router.push('/login')
    }
}
</script>

<style scoped>
.layout-container {
  height: 100vh;
  display: flex;
}
.aside {
  background-color: #1e222d;
  color: #fff;
  display: flex;
  flex-direction: column;
  box-shadow: 2px 0 10px rgba(0, 0, 0, 0.2);
  z-index: 10;
}
.logo {
  height: 64px;
  line-height: 64px;
  text-align: center;
  color: #cda05b;
  border-bottom: 1px solid #2a3140;
  background-color: #1a1d26;
  padding: 0 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
.logo h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
}
.el-menu-vertical {
  border-right: none;
  flex: 1;
}
/* 提升多级菜单的质感 */
:deep(.el-sub-menu__title:hover), :deep(.el-menu-item:hover) {
  background-color: #2a3140 !important;
}
.header {
  height: 64px;
  background-color: #ffffff;
  border-bottom: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  z-index: 9;
}
.main-body {
  padding: 0; 
  position: relative;
  background: linear-gradient(rgba(245, 247, 250, 0.88), rgba(245, 247, 250, 0.95)), url('../assets/login-bg.jpg') center top / cover no-repeat;
  background-attachment: fixed;
  min-height: calc(100vh - 64px);
}

.page-router-wrap {
  position: relative;
  z-index: 2;
  padding: 16px;
}
.el-dropdown-link {
  cursor: pointer;
  color: #333;
  display: flex;
  align-items: center;
}
</style>

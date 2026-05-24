<template>
  <div class="page-wrap" v-loading="loading">
    <div class="page-header">
      <div class="header-main">
        <h2 class="page-title">本地商城 · 首页运营图</h2>
        <p class="page-subtitle">
          配置小程序「本地商城」Tab 的轮播、金刚区与导购卡片，共
          <span class="highlight">8</span> 张。保存后由接口
          <code>GET /local-goods-home/ui-assets</code> 下发。
        </p>
      </div>
      <div class="header-actions">
        <el-button :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :loading="saving" @click="saveAll">保存全部</el-button>
      </div>
    </div>

    <div class="tip-bar">
      <el-icon><InfoFilled /></el-icon>
      <span>支持 jpg / png / webp（≤2MB）；点击预览可放大，使用「上传替换」或修改下方地址。</span>
    </div>

    <div v-for="section in sections" :key="section.key" class="section-block">
      <div class="section-head">
        <span class="section-dot" :class="section.key" />
        <div>
          <h3 class="section-title">{{ section.title }}</h3>
          <p class="section-desc">{{ section.desc }}</p>
        </div>
        <el-tag size="small" effect="plain" round>{{ section.items.length }} 项</el-tag>
      </div>

      <el-row :gutter="20" class="asset-row">
        <el-col
          v-for="item in section.items"
          :key="item.asset_key"
          :xs="24"
          :sm="section.colSm"
          :md="section.colMd"
          :lg="section.colLg"
        >
          <div class="asset-card" :class="`type-${section.key}`">
            <div class="card-top">
              <div class="card-title">{{ item.label }}</div>
              <el-tag class="key-tag" size="small" type="info" effect="light">{{ item.asset_key }}</el-tag>
            </div>

            <div class="preview-box">
                <el-image
                  v-if="item.image_url"
                  :src="imgUrl(item.image_url)"
                  :fit="section.previewFit"
                  class="preview-img"
                  :preview-src-list="[imgUrl(item.image_url)]"
                />
                <div v-else class="preview-empty">
                  <el-icon :size="28"><Picture /></el-icon>
                  <span>暂无图片</span>
                </div>
            </div>

            <div class="url-field">
              <label>图片地址</label>
              <el-input
                v-model="item.image_url"
                placeholder="/uploads/..."
                clearable
                size="small"
              >
                <template #append>
                  <el-button link type="primary" @click="copyUrl(item.image_url)">复制</el-button>
                </template>
              </el-input>
            </div>

            <div class="card-foot">
              <el-upload
                :show-file-list="false"
                accept="image/jpeg,image/png,image/webp"
                :http-request="(opt) => handleUpload(opt, item)"
              >
                <el-button size="small" type="primary" plain>
                  <el-icon><Upload /></el-icon>
                  上传替换
                </el-button>
              </el-upload>
              <el-button size="small" @click="resetOne(item)">恢复默认</el-button>
            </div>
          </div>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { InfoFilled, Picture, Upload } from '@element-plus/icons-vue'
import request from '../utils/request'
import axios from 'axios'

const loading = ref(false)
const saving = ref(false)
const assets = ref([])

const DEFAULTS = {
  bannerHome: '/uploads/file-1773395942165-45947155.png',
  bannerSale: '/uploads/file-1773395942500-585304598.png',
  pushCateFire: '/uploads/img/local_goods_icons/fire.png',
  pushCateGift: '/uploads/img/local_goods_icons/gift.png',
  pushCateStar: '/uploads/img/local_goods_icons/star.png',
  pushCateMoney: '/uploads/img/local_goods_icons/money.png',
  goodsSkincare1: '/uploads/file-1773325942165-459472452.jpg',
  pushFashion1: '/uploads/file-17733293942125-459452655.jpg'
}

const GROUP_META = {
  banner: {
    title: '顶部轮播海报',
    desc: '首页顶部横向轮播，建议宽图 16:9',
    colSm: 24,
    colMd: 12,
    colLg: 12,
    previewFit: 'cover'
  },
  category_icon: {
    title: '金刚区分类图标',
    desc: '四个入口小图标，建议正方形透明底 PNG',
    colSm: 12,
    colMd: 6,
    colLg: 6,
    previewFit: 'contain'
  },
  guide_card: {
    title: '导购卡片图',
    desc: '「品牌好货」「秋冬好物」两张导购卡片',
    colSm: 24,
    colMd: 12,
    colLg: 12,
    previewFit: 'cover'
  }
}

const sections = computed(() => {
  const order = ['banner', 'category_icon', 'guide_card']
  return order
    .map((key) => {
      const meta = GROUP_META[key]
      const items = assets.value.filter((a) => a.group_type === key)
      if (!items.length) return null
      return {
        key,
        title: meta.title,
        desc: meta.desc,
        items,
        colSm: meta.colSm,
        colMd: meta.colMd,
        colLg: meta.colLg,
        previewFit: meta.previewFit
      }
    })
    .filter(Boolean)
})

function imgUrl(url) {
  if (!url) return ''
  if (url.startsWith('http')) return url
  const base = import.meta.env.VITE_API_BASE || '/api/v1'
  return base.replace(/\/api\/v1$/, '') + url
}

async function copyUrl(url) {
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success('已复制地址')
  } catch {
    ElMessage.warning('复制失败，请手动选择')
  }
}

async function load() {
  loading.value = true
  try {
    const res = await request.get('/admin/local-goods-home/ui-assets')
    assets.value = (res.data || []).map((row) => ({ ...row }))
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function handleUpload(options, item) {
  const formData = new FormData()
  formData.append('file', options.file)
  const token = localStorage.getItem('admin_token')
  const base = import.meta.env.VITE_API_BASE || '/api/v1'
  try {
    const res = await axios.post(`${base}/upload?scene=general`, formData, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    const body = res.data
    if (body && typeof body.code === 'number' && body.code !== 0 && body.code !== 200) {
      throw new Error(body.msg || '上传失败')
    }
    const url = body?.data?.url
    if (!url) throw new Error('上传成功但未返回 URL')
    item.image_url = url
    ElMessage.success('已上传，记得点击右上角「保存全部」')
    options.onSuccess(body)
  } catch (e) {
    ElMessage.error(e.message || '上传失败')
    options.onError(e)
  }
}

function resetOne(item) {
  const d = DEFAULTS[item.asset_key]
  if (d) {
    item.image_url = d
    ElMessage.info('已恢复默认，请点击「保存全部」生效')
  }
}

async function saveAll() {
  saving.value = true
  try {
    await request.put('/admin/local-goods-home/ui-assets', {
      assets: assets.value.map((a) => ({
        asset_key: a.asset_key,
        image_url: a.image_url
      }))
    })
    ElMessage.success('已保存')
    await load()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page-wrap {
  max-width: 1280px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid #f0f0f0;
}

.page-title {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 600;
  color: #1f1f1f;
  letter-spacing: 0.02em;
}

.page-subtitle {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #8c8c8c;
}

.page-subtitle .highlight {
  color: #cda05b;
  font-weight: 600;
}

.page-subtitle code {
  padding: 2px 6px;
  font-size: 12px;
  background: #f5f5f5;
  border-radius: 4px;
  color: #595959;
}

.header-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.tip-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 28px;
  padding: 10px 14px;
  font-size: 13px;
  color: #595959;
  background: linear-gradient(90deg, #faf8f5 0%, #fff 100%);
  border: 1px solid #f0ebe3;
  border-radius: 8px;
}

.tip-bar .el-icon {
  color: #cda05b;
  font-size: 16px;
}

.section-block {
  margin-bottom: 36px;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.section-dot {
  width: 4px;
  height: 36px;
  border-radius: 2px;
  flex-shrink: 0;
}

.section-dot.banner {
  background: linear-gradient(180deg, #cda05b, #e8c98a);
}

.section-dot.category_icon {
  background: linear-gradient(180deg, #ff7a45, #ffb88c);
}

.section-dot.guide_card {
  background: linear-gradient(180deg, #597ef7, #91a7ff);
}

.section-title {
  margin: 0 0 2px;
  font-size: 16px;
  font-weight: 600;
  color: #262626;
}

.section-desc {
  margin: 0;
  font-size: 12px;
  color: #8c8c8c;
}

.section-head .el-tag {
  margin-left: auto;
}

.asset-row {
  margin-bottom: 0;
}

.asset-card {
  height: 100%;
  padding: 16px;
  background: #fff;
  border: 1px solid #ebebeb;
  border-radius: 10px;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.asset-card:hover {
  border-color: #e0d5c4;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.card-title {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
  line-height: 1.4;
}

.key-tag {
  flex-shrink: 0;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}

.preview-box {
  position: relative;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  cursor: zoom-in;
  background-color: #f5f5f5;
  background-image:
    linear-gradient(45deg, #eee 25%, transparent 25%),
    linear-gradient(-45deg, #eee 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #eee 75%),
    linear-gradient(-45deg, transparent 75%, #eee 75%);
  background-size: 12px 12px;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  cursor: pointer;
}

.type-banner .preview-box {
  aspect-ratio: 16 / 7;
}

.type-category_icon .preview-box {
  aspect-ratio: 1;
  max-height: 140px;
  margin: 0 auto;
}

.type-guide_card .preview-box {
  aspect-ratio: 4 / 3;
}

.preview-img {
  width: 100%;
  height: 100%;
  display: block;
}

.preview-img :deep(img) {
  width: 100%;
  height: 100%;
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  min-height: 100px;
  color: #bfbfbf;
  font-size: 13px;
}

.url-field {
  margin-top: 12px;
}

.url-field label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: #8c8c8c;
}

.url-field :deep(.el-input__wrapper) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.card-foot {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
</style>

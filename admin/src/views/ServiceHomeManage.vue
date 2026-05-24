<template>
  <div class="service-home-wrap">
    <div class="header-box">
      <h3>服务管理</h3>
      <el-alert
        title="配置小程序首页九宫格及每组下的分类 Tab、服务列表；适用于全部模块（整理收纳、家修急事、家电清洗、开荒保洁、除螨、家具养护、宝宝家事、房屋修缮、上门美业及你新建的 group_key），同一套「模块 → 分类 → 服务」。C 端：GET /api/v1/core/service-home-modules 与 GET /api/v1/core/service-groups/{group_key}。本地库无演示数据可在 backend 执行 node seed_service_groups.js。"
        type="info"
        show-icon
        :closable="false"
      />
    </div>

    <el-tabs v-model="mainTab">
      <el-tab-pane label="首页模块" name="modules">
        <div class="toolbar">
          <el-button type="primary" @click="openModuleDialog()">新增模块</el-button>
          <el-button @click="loadModules">刷新</el-button>
        </div>
        <el-table v-loading="loadingMod" :data="modules" border stripe>
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="group_key" label="group_key" min-width="120" show-overflow-tooltip />
          <el-table-column prop="title" label="标题" min-width="100" />
          <el-table-column prop="price_unit" label="计价单位" width="90" />
          <el-table-column label="图标" width="72">
            <template #default="{ row }">
              <el-image
                v-if="row.icon_url"
                :src="rowImg(row, 'icon_url', 'icon_url_abs')"
                style="width:48px;height:48px;border-radius:4px"
                fit="contain"
              />
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>
          <el-table-column prop="icon_url" label="图标URL" min-width="140" show-overflow-tooltip />
          <el-table-column prop="sort_order" label="排序" width="80" />
          <el-table-column label="启用" width="80">
            <template #default="{ row }">
              <el-tag :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? '是' : '否' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" link @click="openModuleDialog(row)">编辑</el-button>
              <el-button type="danger" link @click="removeModule(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="分类与服务" name="cats">
        <div class="row-select">
          <span class="lbl">当前模块</span>
          <el-select v-model="activeGroupKey" placeholder="选择 group_key" style="width: 280px" filterable @change="onGroupChange">
            <el-option v-for="m in modules" :key="m.group_key" :label="`${m.title} (${m.group_key})`" :value="m.group_key" />
          </el-select>
          <el-button @click="refreshCatsAndSvc" :disabled="!activeGroupKey">刷新</el-button>
        </div>

        <h4 class="sub-title">子分类（Tab）</h4>
        <div class="toolbar">
          <el-button type="primary" size="small" :disabled="!activeGroupKey" @click="openCatDialog()">新增分类</el-button>
        </div>
        <el-table v-loading="loadingCat" :data="categories" border stripe size="small" class="mb-3">
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="name" label="名称" min-width="120" />
          <el-table-column label="图标" width="72">
            <template #default="{ row }">
              <el-image
                v-if="row.icon_url"
                :src="rowImg(row, 'icon_url', 'icon_url_abs')"
                style="width:40px;height:40px;border-radius:4px"
                fit="contain"
              />
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>
          <el-table-column prop="icon_url" label="图标URL" min-width="120" show-overflow-tooltip />
          <el-table-column prop="sort_order" label="排序" width="80" />
          <el-table-column label="操作" width="140">
            <template #default="{ row }">
              <el-button type="primary" link @click="openCatDialog(row)">编辑</el-button>
              <el-button type="danger" link @click="removeCat(row)">删</el-button>
            </template>
          </el-table-column>
        </el-table>

        <h4 class="sub-title">服务项目</h4>
        <div class="toolbar">
          <el-button type="primary" size="small" :disabled="!activeGroupKey || !categories.length" @click="openSvcDialog()">新增服务</el-button>
        </div>
        <el-table v-loading="loadingSvc" :data="services" border stripe size="small">
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column label="分类" min-width="100">
            <template #default="{ row }">{{ row.category && row.category.name }}</template>
          </el-table-column>
          <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
          <el-table-column prop="price" label="价格" width="90" />
          <el-table-column label="上架" width="80">
            <template #default="{ row }">
              <el-tag :type="row.is_published ? 'success' : 'info'" size="small">{{ row.is_published ? '是' : '否' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="封面" width="72">
            <template #default="{ row }">
              <el-image
                v-if="row.cover_image"
                :src="rowImg(row, 'cover_image', 'cover_image_abs')"
                style="width:48px;height:48px;border-radius:4px"
                fit="cover"
              />
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>
          <el-table-column prop="cover_image" label="封面URL" min-width="120" show-overflow-tooltip />
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" link @click="openSvcDialog(row)">编辑</el-button>
              <el-button type="warning" link @click="offlineSvc(row)">下架</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="moduleDlg" :title="moduleEditId ? '编辑模块' : '新增模块'" width="520px" destroy-on-close @closed="resetModuleForm">
      <el-form :model="moduleForm" label-width="110px">
        <el-form-item v-if="!moduleEditId" label="group_key">
          <el-input v-model="moduleForm.group_key" placeholder="小写开头，如 door_beauty" />
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="moduleForm.title" placeholder="小程序内分组页标题" />
        </el-form-item>
        <el-form-item label="计价单位">
          <el-input v-model="moduleForm.price_unit" placeholder="次 / 份" />
        </el-form-item>
        <el-form-item label="九宫格图标">
          <div class="icon-field">
            <el-input
              v-model="moduleForm.icon_url"
              type="textarea"
              :rows="2"
              placeholder="可填外链 URL；或点击下方上传，保存为站点内 /uploads/...（小程序需在请求域名下拼接域名）"
            />
            <div class="icon-row">
              <el-upload
                :action="uploadAction"
                name="file"
                :headers="uploadHeaders"
                :show-file-list="false"
                accept="image/jpeg,image/png,image/webp"
                :on-success="onModuleIconUploaded"
                :on-error="onUploadErr"
              >
                <el-button type="primary" plain size="small">本地上传</el-button>
              </el-upload>
              <span class="upload-hint">jpg/png/webp，最大 2MB</span>
            </div>
            <el-image
              v-if="moduleIconPreview"
              :src="moduleIconPreview"
              class="icon-preview"
              fit="contain"
            />
          </div>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="moduleForm.sort_order" :min="0" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="moduleForm.is_active" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="moduleDlg = false">取消</el-button>
        <el-button type="primary" @click="saveModule">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="catDlg" :title="catEditId ? '编辑分类' : '新增分类'" width="480px" destroy-on-close @closed="resetCatForm">
      <el-form :model="catForm" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="catForm.name" />
        </el-form-item>
        <el-form-item label="图标">
          <div class="icon-field">
            <el-input
              v-model="catForm.icon_url"
              type="textarea"
              :rows="2"
              placeholder="可填外链 URL；或本地上传得到 /uploads/..."
            />
            <div class="icon-row">
              <el-upload
                :action="uploadAction"
                name="file"
                :headers="uploadHeaders"
                :show-file-list="false"
                accept="image/jpeg,image/png,image/webp"
                :on-success="onCatIconUploaded"
                :on-error="onUploadErr"
              >
                <el-button type="primary" plain size="small">本地上传</el-button>
              </el-upload>
              <span class="upload-hint">jpg/png/webp，最大 2MB</span>
            </div>
            <el-image
              v-if="catIconPreview"
              :src="catIconPreview"
              class="icon-preview"
              fit="contain"
            />
          </div>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="catForm.sort_order" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="catDlg = false">取消</el-button>
        <el-button type="primary" @click="saveCat">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="svcDlg" :title="svcEditId ? '编辑服务' : '新增服务'" width="560px" destroy-on-close @closed="resetSvcForm">
      <el-form :model="svcForm" label-width="100px">
        <el-form-item label="所属分类">
          <el-select v-model="svcForm.category_id" placeholder="选择分类" style="width:100%">
            <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="svcForm.title" />
        </el-form-item>
        <el-form-item label="价格">
          <el-input v-model="svcForm.price" placeholder="数字，如 189" />
        </el-form-item>
        <el-form-item label="封面图">
          <div class="icon-field">
            <el-input
              v-model="svcForm.cover_image"
              type="textarea"
              :rows="2"
              placeholder="可填外链 URL；或本地上传得到 /uploads/..."
            />
            <div class="icon-row">
              <el-upload
                :action="uploadAction"
                name="file"
                :headers="uploadHeaders"
                :show-file-list="false"
                accept="image/jpeg,image/png,image/webp"
                :on-success="onSvcCoverUploaded"
                :on-error="onUploadErr"
              >
                <el-button type="primary" plain size="small">本地上传</el-button>
              </el-upload>
              <span class="upload-hint">jpg/png/webp，最大 2MB</span>
            </div>
            <el-image
              v-if="svcCoverPreview"
              :src="svcCoverPreview"
              class="icon-preview cover-preview"
              fit="cover"
            />
          </div>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="svcForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="上架">
          <el-switch v-model="svcForm.is_published" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="svcDlg = false">取消</el-button>
        <el-button type="primary" @click="saveSvc">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '../utils/request'

const uploadAction = `${import.meta.env.VITE_API_BASE || '/api/v1'}/upload?scene=general`

const uploadHeaders = computed(() => {
  const token = localStorage.getItem('admin_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
})

/** 优先用后端返回的绝对地址（小程序同源）；否则相对路径走 Vite 代理 */
function imgUrl(url) {
  if (!url) return ''
  const u = String(url).trim()
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  const base = import.meta.env.VITE_API_BASE || '/api/v1'
  const origin = base.replace(/\/api\/v1\/?$/, '') || ''
  return origin + (u.startsWith('/') ? u : `/${u}`)
}

function rowImg(row, relKey, absKey) {
  if (!row) return ''
  return imgUrl(row[absKey] || row[relKey])
}

const mainTab = ref('modules')
const modules = ref([])
const loadingMod = ref(false)
const activeGroupKey = ref('')
const categories = ref([])
const services = ref([])
const loadingCat = ref(false)
const loadingSvc = ref(false)

const moduleDlg = ref(false)
const moduleEditId = ref(null)
const moduleForm = ref({
  group_key: '',
  title: '',
  price_unit: '次',
  icon_url: '',
  sort_order: 0,
  is_active: true
})

const moduleIconPreview = computed(() => imgUrl(moduleForm.value.icon_url))

function uploadUrlFromRes(res) {
  if (!res || typeof res !== 'object') return null
  if (res.errno === 0 && res.data?.url) return res.data.url
  if ((res.code === 0 || res.code === 200) && res.data?.url) return res.data.url
  return null
}

function onModuleIconUploaded(res) {
  const url = uploadUrlFromRes(res)
  if (url) {
    moduleForm.value.icon_url = url
    ElMessage.success('已上传')
  } else {
    ElMessage.error(res?.errmsg || res?.msg || '上传失败')
  }
}

function onUploadErr() {
  ElMessage.error('上传失败，请检查格式与大小')
}

const catDlg = ref(false)
const catEditId = ref(null)
const catForm = ref({ name: '', icon_url: '', sort_order: 0 })

const catIconPreview = computed(() => imgUrl(catForm.value.icon_url))

function onCatIconUploaded(res) {
  const url = uploadUrlFromRes(res)
  if (url) {
    catForm.value.icon_url = url
    ElMessage.success('已上传')
  } else {
    ElMessage.error(res?.errmsg || res?.msg || '上传失败')
  }
}

const svcDlg = ref(false)
const svcEditId = ref(null)
const svcForm = ref({
  category_id: null,
  title: '',
  price: '',
  cover_image: '',
  description: '',
  is_published: true
})

const svcCoverPreview = computed(() => imgUrl(svcForm.value.cover_image))

function onSvcCoverUploaded(res) {
  const url = uploadUrlFromRes(res)
  if (url) {
    svcForm.value.cover_image = url
    ElMessage.success('已上传')
  } else {
    ElMessage.error(res?.errmsg || res?.msg || '上传失败')
  }
}

async function loadModules() {
  loadingMod.value = true
  try {
    const res = await request.get('/admin/service-home/modules')
    modules.value = res.data || []
    if (activeGroupKey.value && !modules.value.some((m) => m.group_key === activeGroupKey.value)) {
      activeGroupKey.value = ''
    }
  } catch (e) {
    ElMessage.error(e.message || '加载模块失败')
  } finally {
    loadingMod.value = false
  }
}

async function loadCategories() {
  if (!activeGroupKey.value) {
    categories.value = []
    return
  }
  loadingCat.value = true
  try {
    const res = await request.get('/admin/service-home/categories', { params: { group_key: activeGroupKey.value } })
    categories.value = res.data || []
  } catch (e) {
    ElMessage.error(e.message || '加载分类失败')
  } finally {
    loadingCat.value = false
  }
}

async function loadServices() {
  if (!activeGroupKey.value) {
    services.value = []
    return
  }
  loadingSvc.value = true
  try {
    const res = await request.get('/admin/service-home/services', { params: { group_key: activeGroupKey.value } })
    services.value = res.data || []
  } catch (e) {
    ElMessage.error(e.message || '加载服务失败')
  } finally {
    loadingSvc.value = false
  }
}

function onGroupChange() {
  loadCategories()
  loadServices()
}

function refreshCatsAndSvc() {
  loadCategories()
  loadServices()
}

function openModuleDialog(row) {
  if (row) {
    moduleEditId.value = row.id
    moduleForm.value = {
      group_key: row.group_key,
      title: row.title,
      price_unit: row.price_unit || '次',
      icon_url: row.icon_url || '',
      sort_order: row.sort_order != null ? row.sort_order : 0,
      is_active: !!row.is_active
    }
  } else {
    moduleEditId.value = null
    moduleForm.value = {
      group_key: '',
      title: '',
      price_unit: '次',
      icon_url: '',
      sort_order: 0,
      is_active: true
    }
  }
  moduleDlg.value = true
}

function resetModuleForm() {
  moduleEditId.value = null
}

async function saveModule() {
  try {
    const gk = String(moduleForm.value.group_key || '').trim()
    if (moduleEditId.value) {
      await request.put(`/admin/service-home/modules/${moduleEditId.value}`, {
        title: moduleForm.value.title,
        price_unit: moduleForm.value.price_unit,
        icon_url: moduleForm.value.icon_url,
        sort_order: moduleForm.value.sort_order,
        is_active: moduleForm.value.is_active ? 1 : 0
      })
      ElMessage.success('已保存')
    } else {
      if (!gk) {
        ElMessage.warning('请填写 group_key')
        return
      }
      await request.post('/admin/service-home/modules', {
        group_key: gk,
        title: moduleForm.value.title,
        price_unit: moduleForm.value.price_unit,
        icon_url: moduleForm.value.icon_url,
        sort_order: moduleForm.value.sort_order,
        is_active: moduleForm.value.is_active ? 1 : 0
      })
      ElMessage.success('已创建')
      activeGroupKey.value = gk
      mainTab.value = 'cats'
    }
    moduleDlg.value = false
    await loadModules()
    if (activeGroupKey.value) {
      await loadCategories()
      await loadServices()
    }
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  }
}

async function removeModule(row) {
  try {
    await ElMessageBox.confirm(`删除模块 "${row.title}"？不会删除已有关联分类/服务数据。`, '确认', { type: 'warning' })
    await request.delete(`/admin/service-home/modules/${row.id}`)
    ElMessage.success('已删除')
    if (activeGroupKey.value === row.group_key) activeGroupKey.value = ''
    await loadModules()
    await loadCategories()
    await loadServices()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败')
  }
}

function openCatDialog(row) {
  if (!activeGroupKey.value) {
    ElMessage.warning('请先选择模块')
    return
  }
  if (row) {
    catEditId.value = row.id
    catForm.value = { name: row.name, icon_url: row.icon_url || '', sort_order: row.sort_order || 0 }
  } else {
    catEditId.value = null
    catForm.value = { name: '', icon_url: '', sort_order: 0 }
  }
  catDlg.value = true
}

function resetCatForm() {
  catEditId.value = null
}

async function saveCat() {
  try {
    if (catEditId.value) {
      await request.put(`/admin/service-home/categories/${catEditId.value}`, catForm.value)
    } else {
      await request.post('/admin/service-home/categories', {
        group_key: activeGroupKey.value,
        ...catForm.value
      })
    }
    ElMessage.success('已保存')
    catDlg.value = false
    await loadCategories()
    await loadServices()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  }
}

async function removeCat(row) {
  try {
    await ElMessageBox.confirm(`删除分类「${row.name}」？`, '确认', { type: 'warning' })
    await request.delete(`/admin/service-home/categories/${row.id}`)
    ElMessage.success('已删除')
    await loadCategories()
    await loadServices()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败')
  }
}

function openSvcDialog(row) {
  if (!activeGroupKey.value) {
    ElMessage.warning('请先选择模块')
    return
  }
  if (row) {
    svcEditId.value = row.id
    svcForm.value = {
      category_id: row.category_id,
      title: row.title,
      price: String(row.price != null ? row.price : ''),
      cover_image: row.cover_image || '',
      description: row.description || '',
      is_published: !!(row.is_published === 1 || row.is_published === true)
    }
  } else {
    svcEditId.value = null
    const first = categories.value[0]
    svcForm.value = {
      category_id: first ? first.id : null,
      title: '',
      price: '',
      cover_image: '',
      description: '',
      is_published: true
    }
  }
  svcDlg.value = true
}

function resetSvcForm() {
  svcEditId.value = null
}

async function saveSvc() {
  try {
    const payload = {
      category_id: svcForm.value.category_id,
      title: svcForm.value.title,
      price: svcForm.value.price,
      cover_image: svcForm.value.cover_image,
      description: svcForm.value.description,
      is_published: svcForm.value.is_published ? 1 : 0
    }
    if (svcEditId.value) {
      await request.put(`/admin/service-home/services/${svcEditId.value}`, payload)
    } else {
      await request.post('/admin/service-home/services', payload)
    }
    ElMessage.success('已保存')
    svcDlg.value = false
    await loadServices()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  }
}

async function offlineSvc(row) {
  try {
    await request.delete(`/admin/service-home/services/${row.id}`)
    ElMessage.success('已下架')
    await loadServices()
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  }
}

async function ensureCatsTabData() {
  if (!modules.value.length) await loadModules()
  if (!activeGroupKey.value && modules.value.length) {
    activeGroupKey.value = modules.value[0].group_key
  }
  if (activeGroupKey.value) {
    await loadCategories()
    await loadServices()
  }
}

watch(mainTab, (tab) => {
  if (tab === 'cats') ensureCatsTabData()
})

onMounted(() => {
  loadModules()
})
</script>

<style scoped>
.service-home-wrap {
  padding: 16px;
}
.header-box {
  margin-bottom: 16px;
}
.header-box h3 {
  margin: 0 0 10px;
}
.toolbar {
  margin: 8px 0 12px;
}
.row-select {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.row-select .lbl {
  color: #606266;
  font-size: 14px;
}
.sub-title {
  margin: 16px 0 8px;
  font-size: 15px;
}
.mb-3 {
  margin-bottom: 20px;
}
.icon-field {
  width: 100%;
}
.icon-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.upload-hint {
  font-size: 12px;
  color: #909399;
}
.icon-preview {
  width: 72px;
  height: 72px;
  margin-top: 10px;
  border-radius: 6px;
  border: 1px solid #ebeef5;
}
.cover-preview {
  width: 120px;
  height: 120px;
}
.text-muted {
  color: #c0c4cc;
  font-size: 12px;
}
</style>

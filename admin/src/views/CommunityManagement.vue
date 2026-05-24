<template>
  <div class="page-wrap">
    <el-form :inline="true" class="toolbar" @submit.prevent="search">
      <el-form-item label="关键词">
        <el-input
          v-model="keyword"
          clearable
          placeholder="小区名称 / 地址"
          style="width: 200px"
          @clear="search"
        />
      </el-form-item>
      <el-form-item label="城市">
        <el-input
          v-model="city"
          clearable
          placeholder="城市"
          style="width: 140px"
          @clear="search"
        />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="status" clearable placeholder="全部" style="width: 120px" @change="search">
          <el-option label="启用" value="active" />
          <el-option label="停用" value="inactive" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
        <el-button type="success" @click="openCreate">新增小区</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="id" label="ID" width="72" />
      <el-table-column prop="name" label="小区名称" min-width="140" show-overflow-tooltip />
      <el-table-column prop="city" label="城市" width="100" />
      <el-table-column prop="district" label="区域" width="100" />
      <el-table-column prop="address" label="地址" min-width="200" show-overflow-tooltip />
      <el-table-column label="经纬度" width="180">
        <template #default="{ row }">
          <span v-if="row.latitude && row.longitude">{{ row.latitude }}, {{ row.longitude }}</span>
          <span v-else class="text-muted">未设置</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ row.status === 'active' ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="sort_order" label="排序" width="70" />
      <el-table-column prop="service_radius" label="服务半径" width="90">
        <template #default="{ row }">
          {{ row.service_radius ? row.service_radius + 'm' : '—' }}
        </template>
      </el-table-column>
      <el-table-column prop="contact_phone" label="联系电话" width="120" />
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
          <el-button type="warning" link @click="toggleStatus(row)">
            {{ row.status === 'active' ? '下线' : '上线' }}
          </el-button>
          <el-button type="info" link @click="viewStats(row)">统计</el-button>
          <el-button type="danger" link @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="pager"
      v-model:current-page="page"
      v-model:page-size="limit"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="load"
    />

    <!-- 新增/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="editId ? '编辑小区' : '新增小区'" width="600px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="小区名称" required>
          <el-input v-model="form.name" placeholder="请输入小区名称" />
        </el-form-item>
        <el-form-item label="城市">
          <el-input v-model="form.city" placeholder="如：上海市" />
        </el-form-item>
        <el-form-item label="区域">
          <el-input v-model="form.district" placeholder="如：闵行区" />
        </el-form-item>
        <el-form-item label="详细地址">
          <el-input v-model="form.address" type="textarea" :rows="2" placeholder="请输入详细地址" />
        </el-form-item>
        <el-form-item label="纬度">
          <el-input-number v-model="form.latitude" :precision="7" :step="0.001" placeholder="纬度" style="width: 100%" />
        </el-form-item>
        <el-form-item label="经度">
          <el-input-number v-model="form.longitude" :precision="7" :step="0.001" placeholder="经度" style="width: 100%" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="form.contact_phone" placeholder="联系电话" />
        </el-form-item>
        <el-form-item label="服务半径(m)">
          <el-input-number v-model="form.service_radius" :min="0" :step="100" placeholder="服务半径（米）" style="width: 100%" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort_order" :min="0" :step="1" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="active">启用</el-radio>
            <el-radio value="inactive">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 统计对话框 -->
    <el-dialog v-model="statsVisible" title="小区统计" width="400px">
      <el-descriptions :column="1" border v-if="stats">
        <el-descriptions-item label="小区名称">{{ stats.name }}</el-descriptions-item>
        <el-descriptions-item label="用户数">{{ stats.userCount }}</el-descriptions-item>
        <el-descriptions-item label="技工数">{{ stats.workerCount }}</el-descriptions-item>
        <el-descriptions-item label="服务商数">{{ stats.providerCount }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '../utils/request'

const loading = ref(false)
const saving = ref(false)
const rows = ref([])
const total = ref(0)
const page = ref(1)
const limit = ref(20)
const keyword = ref('')
const city = ref('')
const status = ref('')

const dialogVisible = ref(false)
const editId = ref(null)
const form = reactive({
  name: '',
  city: '',
  district: '',
  address: '',
  latitude: null,
  longitude: null,
  contact_phone: '',
  service_radius: 3000,
  sort_order: 0,
  status: 'active'
})

const statsVisible = ref(false)
const stats = ref(null)

async function load() {
  loading.value = true
  try {
    const res = await request.get('/admin/communities/list', {
      params: {
        page: page.value,
        limit: limit.value,
        keyword: keyword.value || undefined,
        city: city.value || undefined,
        status: status.value || undefined
      }
    })
    rows.value = res.data?.list || []
    total.value = res.data?.total ?? 0
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}

function resetForm() {
  editId.value = null
  form.name = ''
  form.city = ''
  form.district = ''
  form.address = ''
  form.latitude = null
  form.longitude = null
  form.contact_phone = ''
  form.service_radius = 3000
  form.sort_order = 0
  form.status = 'active'
}

function openCreate() {
  resetForm()
  dialogVisible.value = true
}

function openEdit(row) {
  editId.value = row.id
  form.name = row.name || ''
  form.city = row.city || ''
  form.district = row.district || ''
  form.address = row.address || ''
  form.latitude = row.latitude ? Number(row.latitude) : null
  form.longitude = row.longitude ? Number(row.longitude) : null
  form.contact_phone = row.contact_phone || ''
  form.service_radius = row.service_radius || 3000
  form.sort_order = row.sort_order || 0
  form.status = row.status || 'active'
  dialogVisible.value = true
}

async function onSave() {
  if (!form.name) {
    ElMessage.warning('请填写小区名称')
    return
  }
  saving.value = true
  try {
    const payload = { ...form }
    if (editId.value) {
      await request.put(`/admin/communities/${editId.value}`, payload)
      ElMessage.success('更新成功')
    } else {
      await request.post('/admin/communities', payload)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    saving.value = false
  }
}

async function toggleStatus(row) {
  const newStatus = row.status === 'active' ? 'inactive' : 'active'
  const label = newStatus === 'active' ? '上线' : '下线'
  try {
    await ElMessageBox.confirm(`确定要${label}「${row.name}」吗？`, '确认', { type: 'warning' })
    await request.patch(`/admin/communities/${row.id}/status`, { status: newStatus })
    ElMessage.success(`${label}成功`)
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '操作失败')
  }
}

async function viewStats(row) {
  statsVisible.value = true
  stats.value = null
  try {
    const res = await request.get(`/admin/communities/${row.id}/stats`)
    stats.value = { name: row.name, ...res.data }
  } catch (e) {
    ElMessage.error(e.message || '获取统计失败')
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确定要删除「${row.name}」吗？此操作不可恢复。`, '确认删除', { type: 'error' })
    await request.delete(`/admin/communities/${row.id}`)
    ElMessage.success('删除成功')
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败')
  }
}

onMounted(load)
</script>

<style scoped>
.page-wrap {
  padding: 16px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.text-muted {
  color: #999;
}
</style>

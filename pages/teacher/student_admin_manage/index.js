const app = getApp();

function normalizeUserInfo(userInfo) {
  const normalized = typeof app.normalizeUserInfo === 'function' ? app.normalizeUserInfo(userInfo) : (userInfo || {});
  const adminLevel = normalized.adminLevel || normalized.admin_level || 'none';
  return {
    ...normalized,
    role: normalized.role || 'student',
    adminLevel,
    hasAdminAccess: typeof app.hasAdminAccess === 'function'
      ? app.hasAdminAccess(normalized)
      : ['admin', 'super_admin'].includes(adminLevel)
  };
}

Page({
  data: {
    loading: true,
    creating: false,
    removingId: null,
    userInfo: {},
    studentAdmins: [],
    grantForm: {
      wechatId: '',
      note: ''
    }
  },

  onLoad() {
    this.refreshUserInfo();
    this.loadData();
  },

  onShow() {
    this.refreshUserInfo();
    this.loadData();
  },

  refreshUserInfo() {
    const userInfo = normalizeUserInfo(app.globalData.userInfo);
    this.setData({ userInfo });
    return userInfo;
  },

  request(options) {
    const token = wx.getStorageSync('token');
    return new Promise((resolve, reject) => {
      wx.request({
        ...options,
        header: {
          ...(options.header || {}),
          Authorization: token
        },
        success: resolve,
        fail: reject
      });
    });
  },


  loadData() {
    this.setData({ loading: true });
    return this.request({
      url: `${app.globalData.baseUrl}/admin/student-admins`,
      method: 'GET'
    }).then((res) => {
      this.setData({ loading: false });
      if (res.statusCode !== 200) {
        wx.showToast({ title: res.data?.error || '学生管理员列表加载失败', icon: 'none' });
        return;
      }
      this.setData({ studentAdmins: res.data?.items || [] });
    });
  },

  onGrantWechatIdInput(e) {
    this.setData({ 'grantForm.wechatId': e.detail.value });
  },

  onGrantNoteInput(e) {
    this.setData({ 'grantForm.note': e.detail.value });
  },

  createStudentAdmin() {
    const wechatId = this.data.grantForm.wechatId.trim();
    if (!wechatId) {
      wx.showToast({ title: '请填写学生微信号', icon: 'none' });
      return;
    }

    this.setData({ creating: true });
    this.request({
      url: `${app.globalData.baseUrl}/admin/student-admins`,
      method: 'POST',
      data: {
        wechatId,
        note: this.data.grantForm.note.trim()
      }
    }).then((res) => {
      this.setData({ creating: false });
      if (res.statusCode === 200 && res.data?.success) {
        wx.showToast({ title: '已授权为学生管理员', icon: 'success' });
        this.setData({ 'grantForm.wechatId': '', 'grantForm.note': '' });
        this.loadData();
        return;
      }
      wx.showToast({ title: res.data?.error || '授权失败', icon: 'none' });
    }).catch(() => {
      this.setData({ creating: false });
      wx.showToast({ title: '授权失败', icon: 'none' });
    });
  },

  removeStudentAdmin(e) {
    const userId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '移除学生管理员',
      content: '移除后该学生将失去树洞回复等管理权限，确定继续？',
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return;
        }
        this.setData({ removingId: userId });
        this.request({
          url: `${app.globalData.baseUrl}/admin/student-admins/${userId}`,
          method: 'DELETE'
        }).then((res) => {
          this.setData({ removingId: null });
          if (res.statusCode === 200 && res.data?.success) {
            wx.showToast({ title: '已移除', icon: 'success' });
            this.loadData();
            return;
          }
          wx.showToast({ title: res.data?.error || '移除失败', icon: 'none' });
        }).catch(() => {
          this.setData({ removingId: null });
          wx.showToast({ title: '移除失败', icon: 'none' });
        });
      }
    });
  }
});

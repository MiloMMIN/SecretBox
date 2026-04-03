const app = getApp();

function normalizeProfile(profile) {
  return app.normalizeTeacherProfile(profile);
}

function buildEditor(profile) {
  if (!profile) {
    return {
      kind: 'invite',
      id: null,
      nickName: '',
      avatarUrl: '',
      desc: '',
      isActive: true,
      inviteCode: '',
      claimed: false
    };
  }

  const normalizedProfile = normalizeProfile(profile);
  return {
    kind: normalizedProfile.kind || 'teacher',
    id: normalizedProfile.id,
    nickName: normalizedProfile.nickName || '',
    avatarUrl: normalizedProfile.avatarUrl || '',
    desc: normalizedProfile.desc || '',
    isActive: normalizedProfile.isActive !== false,
    inviteCode: normalizedProfile.inviteCode || '',
    claimed: !!normalizedProfile.claimed
  };
}

Page({
  data: {
    profiles: [],
    currentIndex: 0,
    editor: buildEditor(),
    uploading: false,
    saving: false,
    creating: false
  },

  onLoad() {
    this.loadProfiles();
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

  loadProfiles() {
    this.request({
      url: `${app.globalData.baseUrl}/teacher/profiles`,
      method: 'GET'
    }).then((res) => {
      if (res.statusCode === 200) {
        const profiles = (res.data || []).map((profile) => normalizeProfile(profile));
        this.setData({
          profiles,
          currentIndex: 0,
          editor: buildEditor(profiles[0])
        });
        return;
      }
      wx.showToast({ title: res.data?.error || '加载失败', icon: 'none' });
    }).catch(() => {
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  switchProfile(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const profile = this.data.profiles[index];
    this.setData({
      currentIndex: index,
      editor: buildEditor(profile)
    });
  },

  createTeacherInvite() {
    this.setData({
      currentIndex: -1,
      creating: true,
      editor: buildEditor({ kind: 'invite', isActive: true })
    });
  },

  onNameInput(e) {
    this.setData({ 'editor.nickName': e.detail.value });
  },

  onDescInput(e) {
    this.setData({ 'editor.desc': e.detail.value });
  },

  onActiveChange(e) {
    this.setData({ 'editor.isActive': e.detail.value });
  },

  chooseAvatar() {
    if (this.data.uploading) {
      return;
    }

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const filePath = res.tempFiles?.[0]?.tempFilePath;
        if (!filePath) {
          return;
        }
        this.uploadAvatar(filePath);
      }
    });
  },

  uploadAvatar(filePath) {
    const token = wx.getStorageSync('token');
    this.setData({ uploading: true });
    wx.uploadFile({
      url: `${app.globalData.baseUrl}/uploads/image`,
      filePath,
      name: 'file',
      header: { Authorization: token },
      success: (res) => {
        this.setData({ uploading: false });
        let data = {};
        try {
          data = JSON.parse(res.data || '{}');
        } catch (error) {
          wx.showToast({ title: '上传失败', icon: 'none' });
          return;
        }

        if (res.statusCode === 200 && data.success) {
          this.setData({ 'editor.avatarUrl': app.normalizeFileUrl(data.url) });
          return;
        }
        wx.showToast({ title: data.error || '上传失败', icon: 'none' });
      },
      fail: () => {
        this.setData({ uploading: false });
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  saveProfile() {
    this.setData({ saving: true });
    const isInvite = this.data.editor.kind === 'invite';
    const method = this.data.creating ? 'POST' : 'PUT';
    const url = this.data.creating
      ? `${app.globalData.baseUrl}/teacher/invites`
      : (isInvite
        ? `${app.globalData.baseUrl}/teacher/invites/${this.data.editor.id}`
        : `${app.globalData.baseUrl}/teacher/profiles/${this.data.editor.id}`);

    this.request({
      url,
      method,
      data: {
        nickName: this.data.editor.nickName.trim(),
        avatarUrl: this.data.editor.avatarUrl,
        desc: this.data.editor.desc.trim(),
        isActive: this.data.editor.isActive
      }
    }).then((res) => {
      this.setData({ saving: false });
      if (res.statusCode === 200 && res.data.success) {
        const profile = normalizeProfile(res.data.profile);
        const profiles = [...this.data.profiles];
        if (this.data.creating) {
          profiles.unshift(profile);
        } else {
          profiles[this.data.currentIndex] = profile;
        }

        const nextIndex = this.data.creating ? 0 : this.data.currentIndex;
        this.setData({
          profiles,
          currentIndex: nextIndex,
          creating: false,
          editor: buildEditor(profile)
        });

        if (profile.kind === 'teacher' && app.globalData.userInfo && app.globalData.userInfo.id === profile.id) {
          const userInfo = {
            ...app.globalData.userInfo,
            nickName: profile.nickName,
            avatarUrl: profile.avatarUrl || app.globalData.userInfo.avatarUrl
          };
          app.globalData.userInfo = userInfo;
          wx.setStorageSync('userInfo', userInfo);
        }

        wx.showToast({ title: '保存成功', icon: 'success' });
        return;
      }
      wx.showToast({ title: res.data?.error || '保存失败', icon: 'none' });
    }).catch(() => {
      this.setData({ saving: false });
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  copyInviteCode() {
    if (!this.data.editor.inviteCode) {
      wx.showToast({ title: '当前不是待激活教师', icon: 'none' });
      return;
    }

    wx.setClipboardData({
      data: this.data.editor.inviteCode,
      success: () => {
        wx.showToast({ title: '邀请码已复制', icon: 'success' });
      }
    });
  },

  deleteTeacher() {
    if (this.data.editor.kind !== 'teacher') {
      wx.showToast({ title: '只能删除已激活的教师', icon: 'none' });
      return;
    }

    const teacherId = this.data.editor.id;
    const teacherName = this.data.editor.nickName;

    wx.showModal({
      title: '确认删除',
      content: `确定要删除教师「${teacherName}」吗？删除后该用户将降级为学生身份，其发布的内容不会被删除。`,
      confirmColor: '#FF5252',
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return;
        }

        this.setData({ saving: true });
        this.request({
          url: `${app.globalData.baseUrl}/teacher/profiles/${teacherId}`,
          method: 'DELETE'
        }).then((res) => {
          this.setData({ saving: false });
          console.log('Delete response:', res.statusCode, res.data);
          if (res.statusCode === 200 && res.data.success) {
            wx.showToast({ title: '删除成功', icon: 'success' });
            // Remove from list and reset editor
            const profiles = this.data.profiles.filter(p => p.id !== teacherId);
            this.setData({
              profiles,
              currentIndex: 0,
              editor: buildEditor(profiles[0]),
              creating: false
            });
            return;
          }
          const errorMsg = res.data?.error || `删除失败 (${res.statusCode})`;
          wx.showToast({ title: errorMsg, icon: 'none' });
        }).catch((err) => {
          console.error('Delete error:', err);
          this.setData({ saving: false });
          wx.showToast({ title: '网络错误', icon: 'none' });
        });
      }
    });
  }
})

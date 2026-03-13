const app = getApp();

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

  return {
    kind: profile.kind || 'teacher',
    id: profile.id,
    nickName: profile.nickName || '',
    avatarUrl: profile.avatarUrl || '',
    desc: profile.desc || '',
    isActive: profile.isActive !== false,
    inviteCode: profile.inviteCode || '',
    claimed: !!profile.claimed
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
        const profiles = res.data || [];
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
        const data = JSON.parse(res.data || '{}');
        if (res.statusCode === 200 && data.success) {
          this.setData({ 'editor.avatarUrl': data.url });
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
        const profiles = [...this.data.profiles];
        if (this.data.creating) {
          profiles.unshift(res.data.profile);
        } else {
          profiles[this.data.currentIndex] = res.data.profile;
        }

        const nextIndex = this.data.creating ? 0 : this.data.currentIndex;
        this.setData({
          profiles,
          currentIndex: nextIndex,
          creating: false,
          editor: buildEditor(res.data.profile)
        });

        if (res.data.profile.kind === 'teacher' && app.globalData.userInfo && app.globalData.userInfo.id === res.data.profile.id) {
          const userInfo = {
            ...app.globalData.userInfo,
            nickName: res.data.profile.nickName,
            avatarUrl: res.data.profile.avatarUrl || app.globalData.userInfo.avatarUrl
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
  }
})

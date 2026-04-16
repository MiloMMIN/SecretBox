Page({
  goToProfile() {
    wx.switchTab({
      url: '/pages/profile/profile'
    })
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/profile/profile'
        })
      }
    })
  }
})

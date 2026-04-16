Page({
  goHome() {
    wx.navigateTo({
      url: '/pages/welcome/index'
    })
  },

  goToDelivery() {
    wx.switchTab({
      url: '/pages/post/select_counselor'
    })
  }
})

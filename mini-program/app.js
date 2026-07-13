App({globalData:{apiBase:"http://localhost:3000",token:"",role:"student"},onLaunch(){this.globalData.token=wx.getStorageSync("mini-token")||""}})

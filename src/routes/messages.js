// src/routes/messages.js
// 站内消息路由（所有角色通用）

const router  = require('express').Router()
const { authenticate } = require('../middleware/auth')
const msgCtrl = require('../controllers/messageController')

const auth = [authenticate]

router.get   ('/',        ...auth, (r, s) => msgCtrl.list(r, s))
router.get   ('/unread',  ...auth, (r, s) => msgCtrl.listUnread(r, s))
router.post  ('/read',    ...auth, (r, s) => msgCtrl.markRead(r, s))
router.delete('/:id',     ...auth, (r, s) => msgCtrl.remove(r, s))

module.exports = router

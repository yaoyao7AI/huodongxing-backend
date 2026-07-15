const express = require("express");
const usersController = require("../controllers/usersController");
const { requireAdmin, requireLocalUser } = require("../middlewares/permissions");

const router = express.Router();

// users CRUD 仅本地用户；Events Token 一律 403（本期不开放）
router.get("/", requireLocalUser, usersController.list);
router.get("/:id", requireLocalUser, usersController.getById);
router.post("/", requireAdmin, usersController.create);
router.put("/:id", requireAdmin, usersController.updateById);
router.delete("/:id", requireAdmin, usersController.deleteById);

module.exports = router;

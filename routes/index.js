const express = require("express");

const authRoutes = require("./auth");
const { authenticate } = require("../middlewares/authenticate");
const organizationsRoutes = require("./organizations");
const usersRoutes = require("./users");
const activitiesRoutes = require("./activities");
const activityRegistrationsRoutes = require("./activity_registrations");

const router = express.Router();

router.use("/auth", authRoutes);
// 其余 API 默认要求登录：Events Token 或本地 AUTH Token
router.use(authenticate);
router.use("/organizations", organizationsRoutes);
router.use("/users", usersRoutes);
router.use("/activities", activitiesRoutes);
router.use("/activity_registrations", activityRegistrationsRoutes);

module.exports = router;

const express = require("express");
const authController = require("../controllers/authController");
const { exchange } = require("../controllers/eventsExchangeController");
const { authenticate } = require("../middlewares/authenticate");

const router = express.Router();

router.post("/login", authController.login);
router.post("/exchange", exchange);
router.get("/me", authenticate, authController.me);

module.exports = router;

const express = require("express");
const organizationsController = require("../controllers/organizationsController");
const { requireEventsPermission } = require("../middlewares/eventsAuth");

const router = express.Router();

router.get("/", requireEventsPermission("events.organizations.read"), organizationsController.list);
router.get("/:id", requireEventsPermission("events.organizations.read"), organizationsController.getById);
router.post("/", requireEventsPermission("events.organizations.write"), organizationsController.create);
router.put("/:id", requireEventsPermission("events.organizations.write"), organizationsController.updateById);
router.delete("/:id", requireEventsPermission("events.organizations.write"), organizationsController.deleteById);

module.exports = router;

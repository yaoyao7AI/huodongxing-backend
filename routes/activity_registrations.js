const express = require("express");
const activityRegistrationsController = require("../controllers/activityRegistrationsController");
const { requireEventsPermission } = require("../middlewares/eventsAuth");

const router = express.Router();

router.get("/", requireEventsPermission("events.registrations.read"), activityRegistrationsController.list);
router.get("/:id", requireEventsPermission("events.registrations.read"), activityRegistrationsController.getById);
router.post("/", requireEventsPermission("events.registrations.write"), activityRegistrationsController.create);
router.put("/:id", requireEventsPermission("events.registrations.write"), activityRegistrationsController.updateById);
router.delete("/:id", requireEventsPermission("events.registrations.write"), activityRegistrationsController.deleteById);

module.exports = router;

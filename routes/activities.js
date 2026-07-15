const express = require("express");
const activitiesController = require("../controllers/activitiesController");
const { requireEventsPermission } = require("../middlewares/eventsAuth");

const router = express.Router();

router.get("/", requireEventsPermission("events.activities.read"), activitiesController.list);
router.get("/:id", requireEventsPermission("events.activities.read"), activitiesController.getById);
router.post("/", requireEventsPermission("events.activities.write"), activitiesController.create);
router.put("/:id", requireEventsPermission("events.activities.write"), activitiesController.updateById);
router.delete("/:id", requireEventsPermission("events.activities.write"), activitiesController.deleteById);

module.exports = router;

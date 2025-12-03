// ⚠️ AUTO-GENERATED FILE — do not edit manually.
import { ActivityAssignment } from "./entities/activity/ActivityAssignment";
import { ActivityAssignmentRole } from "./entities/activity/ActivityAssignmentRole";
import { ActivityPlan } from "./entities/activity/ActivityPlan";
import { ActivityPlanRequirement } from "./entities/activity/ActivityPlanRequirement";
import { ActivitySlot } from "./entities/activity/ActivitySlot";
import { ActivitySlotRole } from "./entities/activity/ActivitySlotRole";
import { DriversAssignment } from "./entities/drivers/DriversAssignment";
import { DriversItem } from "./entities/drivers/DriversItem";
import { DriversList } from "./entities/drivers/DriversList";
import { Event } from "./entities/event/Event";
import { EventRegBypassLink } from "./entities/event/EventRegBypassLink";
import { EventRegistration } from "./entities/event/EventRegistration";
import { EventRegistrationDietary } from "./entities/event/EventRegistrationDietary";
import { PackingAssignment } from "./entities/packing/PackingAssignment";
import { PackingItem } from "./entities/packing/PackingItem";
import { PackingList } from "./entities/packing/PackingList";
import { EntityAdminAssignment } from "./entities/permissions/EntityAdminAssignment";
import { EntityPermissions } from "./entities/permissions/EntityPermissions";
import { Session } from "./entities/session/Session";
import { Survey } from "./entities/surveys/Survey";
import { SurveyCombination } from "./entities/surveys/SurveyCombination";
import { SurveyResponse } from "./entities/surveys/SurveyResponse";
import { Guest } from "./entities/user/Guest";
import { GuestLink } from "./entities/user/GuestLink";
import { Role } from "./entities/user/Role";
import { User } from "./entities/user/User";
import { AddCheckSlotRoleTrigger1752829591073 } from "../../migrations/1752829591073-AddCheckSlotRoleTrigger";
import { ActivityAssignmentRolesSubscriber } from "./subscribers/activityAssignmentRole";

export const entities = [ActivityAssignment, ActivityAssignmentRole, ActivityPlan, ActivityPlanRequirement, ActivitySlot, ActivitySlotRole, DriversAssignment, DriversItem, DriversList, Event, EventRegBypassLink, EventRegistration, EventRegistrationDietary, PackingAssignment, PackingItem, PackingList, EntityAdminAssignment, EntityPermissions, Session, Survey, SurveyCombination, SurveyResponse, Guest, GuestLink, Role, User];

export const migrations = [AddCheckSlotRoleTrigger1752829591073];

export const subscribers = [ActivityAssignmentRolesSubscriber];

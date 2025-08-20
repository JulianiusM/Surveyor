import {DriversItem} from "../modules/database/entities/drivers/DriversItem";

export type EnrichedDriversItem = DriversItem & {
    assignedCount: number;
    driverName: string;
};
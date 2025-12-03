import express from "express";
import {createUserSearchApiRouter} from "../../middleware/adminApiFactory";

const app = express.Router();

app.use(createUserSearchApiRouter());

export default app;
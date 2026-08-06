import express, {Request, Response} from 'express';
import rateLimit from "express-rate-limit";
import * as userController from "../../controller/userController";
import {createUserSearchApiRouter} from "../../middleware/adminApiFactory";
import {asyncHandler} from "../../modules/lib/asyncHandler";
import renderer from '../../modules/renderer';

const app = express.Router();

const searchLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    limit: 10,                  // 10 searches / 10 min per IP
    standardHeaders: true,
    legacyHeaders: false,
});

app.post('/guest/email', searchLimiter, asyncHandler(async (req: Request, res: Response) => {
    if (!req.body?.email || !await userController.hasGuestAccountForEmail(req.body.email)) {
        renderer.respondWithErrorJson(res, "none");
        return;
    }

    renderer.respondWithSuccessJson(res, "present");
}));

app.use(createUserSearchApiRouter());

export default app;
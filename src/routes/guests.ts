import express, {Request, Response} from "express";
import * as userController from "../controller/userController";
import {isGuest} from "../middleware/permissionMiddleware";
import {asyncHandler} from "../modules/lib/asyncHandler";
import renderer from "../modules/renderer";

const app = express.Router();

app.get('/recovery', asyncHandler(async (req: Request, res: Response) => {
    res.redirect("/users/login")
}));

app.post("/recovery", asyncHandler(async (req: Request, res: Response) => {
    await userController.recoverGuestAccount(req.body.email);
    renderer.renderMessage(res, "success", "The link(s) to your guest account(s) have been sent to your email address.");
}));

app.get('/dashboard', isGuest, asyncHandler(async (req: Request, res: Response) => {
    renderer.renderWithData(res, 'users/dashboard', await userController.getGuestDashboardEntities(req.session.guest!));
}));

app.get('/:id/login/:token', asyncHandler(async (req: Request, res: Response) => {
    await userController.loginGuest(req.params.id, req.params.token, req.session);
    req.flash('success', 'Login successful');
    if (typeof req.query.next === 'string') {
        res.redirect(req.query.next);
    } else {
        res.redirect("/guest/dashboard");
    }
}));

export default app;
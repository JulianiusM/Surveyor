/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import express, {Request, Response} from "express";
import * as userController from "../controller/userController";
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

app.get('/:id/login/:token', asyncHandler(async (req: Request, res: Response) => {
    await userController.loginGuest(req.params.id as string, req.params.token as string, req.session);
    req.flash('success', 'Login successful');
    if (typeof req.query.next === 'string') {
        res.redirect(req.query.next);
    } else {
        res.redirect("/users/dashboard");
    }
}));

export default app;
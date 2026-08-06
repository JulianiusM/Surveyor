import {NextFunction, Request, Response} from "express";
import settings from "../modules/settings";

export function addNextQuery(localPart: string, notStartsWith?: string) {
    return (req: Request, res: Response, nxt: NextFunction) => {
        let next = req.query.next;
        if (typeof next === "string" && !next.startsWith("/")) {
            // Not a relative path --> remove
            return res.redirect(localPart);
        }
        let ref = req.headers.referer;
        if (!next && ref?.startsWith(settings.value.rootUrl)) {
            ref = ref.replace(settings.value.rootUrl, "");
            if (!ref.startsWith("/")) {
                ref = "/" + ref;
            }
            if (ref != "/" && !ref.startsWith(localPart) && (!notStartsWith || !ref.startsWith(notStartsWith))) {
                return res.redirect(`${localPart}?next=${encodeURIComponent(ref)}`);
            }
        }
        nxt();
    }
}
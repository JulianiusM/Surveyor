// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'ExpectedEr... Remove this comment to see the full error message
const {ExpectedError, APIError, ValidationError} = require("../modules/lib/errors");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'renderer'.
const renderer = require("../modules/renderer");

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = (err: any, req: any, res: any, next: any) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status);

    if (err instanceof ExpectedError) {
        return renderer.renderMessageData(
            res,
            err.severity,
            err.message,
            err.data
        )
    }

    if (err instanceof APIError) {
        // API --> JSON
        return renderer.respondWithErrorDataJson(
            res,
            err.message,
            err.data
        )
    }

    console.log(err);

    if (err instanceof ValidationError) {
        // form validation or business errors with template/data
        return renderer.renderWithErrorData(
            res,
            err.template,
            err.message,
            err.data
        );
    }

    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.code = status;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    renderer.render(res, 'error');
}
const {ExpectedError, APIError, ValidationError} = require("../modules/lib/errors");
const renderer = require("../modules/renderer");

module.exports = (err, req, res, next) => {
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
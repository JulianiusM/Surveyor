//Wrapper for rendering pages
module.exports = {
    //Default rendering
    render,

    //Message rendering
    renderError,
    renderErrorData,
    renderInfo,
    renderInfoData,
    renderSuccess,
    renderSuccessData,
    renderMessage,
    renderMessageData,

    //Page rendering
    renderWithError,
    renderWithErrorData,
    renderWithInfo,
    renderWithInfoData,
    renderWithSuccess,
    renderWithSuccessData,
    renderWithMessage,
    renderWithMessageData,
    renderWithData,

    //Default response
    respond,

    //Formatted response
    respondWithErrorJson,
    respondWithErrorDataJson,
    respondWithInfoJson,
    respondWithInfoDataJson,
    respondWithSuccessJson,
    respondWithSuccessDataJson,
    respondStructuredJson,
    respondWithJson
}


/*-----------[BEGINN>MESSAGE]----------*/

/*-----------[ERROR]----------*/

function renderError(res, message) {
    renderErrorData(res, message, undefined);
}

function renderErrorData(res, message, data) {
    renderMessageData(res, "error", message, data);
}

/*-----------[INFO]----------*/

function renderInfo(res, message) {
    renderInfoData(res, message, undefined);
}

function renderInfoData(res, message, data) {
    renderMessageData(res, "info", message, data);
}

/*-----------[SUCCESS]----------*/

function renderSuccess(res, message) {
    renderSuccessData(res, message, undefined);
}

function renderSuccessData(res, message, data) {
    renderMessageData(res, "success", message, data);
}

/*-----------[GENERIC]----------*/

function renderMessage(res, status, message) {
    renderMessageData(res, status, message, undefined);
}

function renderMessageData(res, status, message, data) {
    renderWithMessageData(res, "message", status, message, data);
}

/*-----------[END>MESSAGE]----------*/


/*-----------[BEGINN>PAGE]----------*/

/*-----------[ERROR]----------*/

function renderWithError(res, page, message) {
    renderWithErrorData(res, page, message, undefined);
}

function renderWithErrorData(res, page, message, data) {
    renderWithMessageData(res, page, "error", message, data);
}

/*-----------[INFO]----------*/

function renderWithInfo(res, page, message) {
    renderWithInfoData(res, page, message, undefined);
}

function renderWithInfoData(res, page, message, data) {
    renderWithMessageData(res, page, "info", message, data);
}

/*-----------[SUCCESS]----------*/

function renderWithSuccess(res, page, message) {
    renderWithSuccessData(res, page, message, undefined);
}

function renderWithSuccessData(res, page, message, data) {
    renderWithMessageData(res, page, "success", message, data);
}

/*-----------[GENERIC]----------*/

function render(res, page) {
    renderWithData(res, page, undefined);
}

function renderWithData(res, page, data) {
    renderWithMessageData(res, page, undefined, undefined, data);
}

function renderWithMessage(res, page, status, message) {
    renderWithMessageData(res, page, status, message, undefined);
}

function renderWithMessageData(res, page, status, message, data) {
    res.render(page, {
        status: status,
        message: message,
        data: data
    });
}

/*-----------[END>PAGE]----------*/


/*-----------[BEGINN>APIRESPONSES]----------*/

/*-----------[ERROR]----------*/

function respondWithErrorJson(res, message) {
    respondWithErrorDataJson(res, message, null);
}

function respondWithErrorDataJson(res, message, data) {
    respondStructuredJson(res, "error", message, data);
}

/*-----------[INFO]----------*/

function respondWithInfoJson(res, message) {
    respondWithInfoDataJson(res, message, null);
}

function respondWithInfoDataJson(res, message, data) {
    respondStructuredJson(res, "info", message, data);
}

/*-----------[SUCCESS]----------*/

function respondWithSuccessJson(res, message) {
    respondWithSuccessDataJson(res, message, null);
}

function respondWithSuccessDataJson(res, message, data) {
    respondStructuredJson(res, "success", message, data);
}

/*-----------[GENERIC]----------*/

function respondStructuredJson(res, status, message, data) {
    respondWithJson(res, {
        status: status,
        message: message,
        data: data
    });
}

function respondWithJson(res, data) {
    res.header("Content-Type", 'application/json');
    respond(res, JSON.stringify(data));
}

function respond(res, data) {
    res.end(data);
}

/*-----------[END>APIRESPONSES]----------*/

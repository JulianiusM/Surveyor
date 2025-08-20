//Wrapper for rendering pages
export default {
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

function renderError(res: any, message: any) {
    renderErrorData(res, message, undefined);
}

function renderErrorData(res: any, message: any, data: any) {
    renderMessageData(res, "error", message, data);
}

/*-----------[INFO]----------*/

function renderInfo(res: any, message: any) {
    renderInfoData(res, message, undefined);
}

function renderInfoData(res: any, message: any, data: any) {
    renderMessageData(res, "info", message, data);
}

/*-----------[SUCCESS]----------*/

function renderSuccess(res: any, message: any) {
    renderSuccessData(res, message, undefined);
}

function renderSuccessData(res: any, message: any, data: any) {
    renderMessageData(res, "success", message, data);
}

/*-----------[GENERIC]----------*/

function renderMessage(res: any, status: any, message: any) {
    renderMessageData(res, status, message, undefined);
}

function renderMessageData(res: any, status: any, message: any, data: any) {
    renderWithMessageData(res, "message", status, message, data);
}

/*-----------[END>MESSAGE]----------*/


/*-----------[BEGINN>PAGE]----------*/

/*-----------[ERROR]----------*/

function renderWithError(res: any, page: any, message: any) {
    renderWithErrorData(res, page, message, undefined);
}

function renderWithErrorData(res: any, page: any, message: any, data: any) {
    renderWithMessageData(res, page, "error", message, data);
}

/*-----------[INFO]----------*/

function renderWithInfo(res: any, page: any, message: any) {
    renderWithInfoData(res, page, message, undefined);
}

function renderWithInfoData(res: any, page: any, message: any, data: any) {
    renderWithMessageData(res, page, "info", message, data);
}

/*-----------[SUCCESS]----------*/

function renderWithSuccess(res: any, page: any, message: any) {
    renderWithSuccessData(res, page, message, undefined);
}

function renderWithSuccessData(res: any, page: any, message: any, data: any) {
    renderWithMessageData(res, page, "success", message, data);
}

/*-----------[GENERIC]----------*/

function render(res: any, page: any) {
    renderWithData(res, page, undefined);
}

function renderWithData(res: any, page: any, data: any) {
    renderWithMessageData(res, page, undefined, undefined, data);
}

function renderWithMessage(res: any, page: any, status: any, message: any) {
    renderWithMessageData(res, page, status, message, undefined);
}

function renderWithMessageData(res: any, page: any, status: any, message: any, data: any) {
    res.render(page, {
        status: status,
        message: message,
        data: data
    });
}

/*-----------[END>PAGE]----------*/


/*-----------[BEGINN>APIRESPONSES]----------*/

/*-----------[ERROR]----------*/

function respondWithErrorJson(res: any, message: any) {
    respondWithErrorDataJson(res, message, null);
}

function respondWithErrorDataJson(res: any, message: any, data: any) {
    respondStructuredJson(res, "error", message, data);
}

/*-----------[INFO]----------*/

function respondWithInfoJson(res: any, message: any) {
    respondWithInfoDataJson(res, message, null);
}

function respondWithInfoDataJson(res: any, message: any, data: any) {
    respondStructuredJson(res, "info", message, data);
}

/*-----------[SUCCESS]----------*/

function respondWithSuccessJson(res: any, message: any) {
    respondWithSuccessDataJson(res, message, null);
}

function respondWithSuccessDataJson(res: any, message: any, data: any) {
    respondStructuredJson(res, "success", message, data);
}

/*-----------[GENERIC]----------*/

function respondStructuredJson(res: any, status: any, message: any, data: any) {
    respondWithJson(res, {
        status: status,
        message: message,
        data: data
    });
}

function respondWithJson(res: any, data: any) {
    res.header("Content-Type", 'application/json');
    respond(res, JSON.stringify(data));
}

function respond(res: any, data: any) {
    res.end(data);
}

/*-----------[END>APIRESPONSES]----------*/

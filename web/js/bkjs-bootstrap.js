//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

// Bootstrap backend support

Bkjs.showAlert = function(obj, type, text, options)
{
    if (typeof obj == "string") options = text, text = type, type = obj, obj = $("body");
    if (!options) options = {};
    text = "<div class='alert alert-dissmisible alert-" + type + "' role='alert'>" + text
    if (options.dismiss) text += '<button type="button" class="close" data-dismiss="alert"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button>';
    text += "</div>";
    $(obj).find(".alerts").empty().append(text);
    if (!options.dismiss) $(obj).find(".alerts div").hide().fadeIn(200).delay(5000 + (type == "error" ? 5000 : 0)).fadeOut(1000, function () { $(this).remove(); });
    if (options.scroll) $(obj).animate({ scrollTop: 0 }, "slow");
}

// Login UI control
Bkjs.hideLogin = function()
{
    $("#bkjs-login-modal").modal("hide");
}

Bkjs.showLogin = function(callback)
{
    var modal = $('#bkjs-login-modal');
    if (!modal.length) {
        modal = $(
        '<div id="bkjs-login-modal" class="modal fade" tabindex="-1" role="dialog" aria-labelledby="LoginLabel" aria-hidden="true">\
          <div class="modal-dialog">\
           <div class="modal-content">\
            <form role="form">\
            <div class="modal-header">\
             <button type="button" class="close" data-dismiss="modal"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button>\
             <h4 class="modal-title" id="LoginLabel">Please Sign In</h4>\
            </div>\
            <div class="modal-body">\
              <div class="alerts"></div>\
              <div class="form-group">\
               <label for="bkjs-login">Login</label>\
               <input class="form-control" placeholder="Login" type="text" autofocus>\
              </div>\
              <div class="form-group">\
               <label for="bkjs-login">Password</label>\
               <input class="form-control" placeholder="Password" type="password" value="">\
              </div>\
            </div>\
            <div class="modal-footer">\
             <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>\
             <button type="submit" class="btn btn-primary">Login</button>\
            </div>\
            </form>\
           </div>\
          </div>\
        </div>').
        appendTo("body");
    }
    var form = modal.find('form');
    var login = form.find('input[type=text]');
    var secret = form.find('input[type=password]');
    modal.off().on('shown.bs.modal', function () { $(this).find('input:text:visible:first').focus(); });
    login.off().on("keyup", function(e) { if (e.which == 13) { secret.focus(); e.preventDefault(); } });
    secret.off().on("keyup", function(e) { if (e.which == 13) { form.trigger("submit"); e.preventDefault(); } });
    form.find('button[type=submit]').off().on("click", function(e) { form.trigger("submit"); e.preventDefault(); });
    form.off().on("submit", function() {
        Bkjs.login(login.val(), secret.val(), function(err, data, xhr) {
            if (err) Bkjs.showAlert(modal, "danger", err);
            if (typeof callback == "function") callback(err, data, xhr);
        });
        return false;
    });
    modal.modal("show");
}

module.exports = require('should');

var Schema = require('jugglingdb').Schema;

global.getSchema = function() {
    var db = new Schema(require('../'), {
        host: 'localhost',
        port: '8000',
        logLevel: 'info'
    });
    db.log = function (a) { console.log(a); };

    return db;
};

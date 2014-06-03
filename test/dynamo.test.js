var should = require('./init.js');

var User;

describe('dynamodb', function(){

    before(function() {
      db = getSchema();
      User = db.define('User', {
        id: { type: String, keyType: "hash", uuid: true},
        name: { type: String },
        email: { type: String },
        age: {type: Number},
        tasks: { type: String, properties: { breaker: 2} }
      });
    });

  beforeEach(function(done) {
    setTimeout(function() {
      done();
    }, 1500);
  });

  it('should create user without any errors', function (done) {
    var tempUser = new User({
      name: "John Doe",
      email: "john@doe.com",
      age: 20,
      tasks: "Blah blah blah"
    });
    User.create(tempUser, function (err, user) {
      should.not.exist(err);
      user.should.have.property('name', 'John Doe');
      done();
    });
  });

});
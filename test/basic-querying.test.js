// This test written in mocha+should.js
var should = require('./init.js');
var db, User;

describe('basic-querying', function() {

    before(function(done) {
        db = getSchema();

        User = db.define('User', {
            name: {type: String, sort: true, limit: 100},
            email: {type: String, index: true, limit: 100},
            role: {type: String, index: true, limit: 100},
            order: {type: Number, index: true, sort: true, limit: 100}
        });

       	db.adapter.emitter.on("created", function(){
          done();
      });

    });


    describe('find', function() {

        before(function(done) {
		done();
        });

        it('should query by id: not found', function(done) {
            User.find("1", function(err, u) {
                should.not.exist(u);
                should.not.exist(err);
                done();
            });
        });

        it('should query by id: found', function(done) {
            User.create(function(err, u) {
                should.not.exist(err);
                should.exist(u.id);
                User.find(u.id, function(err, u) {
                    should.exist(u);
                    should.not.exist(err);
                    u.should.be.an.instanceOf(User);
					u.destroy(function(err) {
						 done();
					});
                   
                });
            });
        });

    });

    describe('all', function() {

        before(seed);

        it('should query collection', function(done) {
            User.all(function(err, users) {
                should.exists(users);
                should.not.exists(err);
                users.should.have.lengthOf(6);
                done();
            });
        });
        
        
        it('should query filtered collection', function(done) {
            User.all({where: {role: 'lead'}}, function(err, users) {
                should.exists(users);
                should.not.exists(err);
                users.should.have.lengthOf(2);
                done();
            });
        });

    });


    describe('findOne', function() {

        before(seed);

        it('should work even when find by id', function(done) {
            User.findOne(function(e, u) {
                User.findOne({where: {id: u.id}}, function(err, user) {
                    should.not.exist(err);
                    should.exist(user);
                    done();
                });
            });
        });

    });
});

function seed(done) {
    var count = 0;
    var beatles = [
        {
            name: 'John Lennon',
            mail: 'john@b3atl3s.co.uk',
            role: 'lead',
            order: 2
        }, {
            name: 'Paul McCartney',
            mail: 'paul@b3atl3s.co.uk',
            role: 'lead',
            order: 1
        },
        {name: 'George Harrison', order: 5},
        {name: 'Ringo Starr', order: 6},
        {name: 'Pete Best', order: 4},
        {name: 'Stuart Sutcliffe', order: 3}
    ];
    
        beatles.forEach(function(beatle) {
            User.create(beatle, ok);
        });
  

    function ok() {
        if (++count === beatles.length) {
            done();
        }
    }
}

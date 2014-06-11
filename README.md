##JugglingDB Adapter for DynamoDB
* Dependencies : `aws-sdk`, `colors`, `async`, `winston`.
* Installation:
    `npm install jugglingdb-dynamodb`
* Github repository: <a href = "https://github.com/tmpaul/jugglingdb-dynamodb">jugglingdb-dynamodb</a>

### Using the adapter with DynamoDB Local
* During the testing/development phase of your application's lifecycle, it is a good idea to use DynamoDB local. DynamoDB local is a java archive file that runs on your machine, and it does a very good job at mocking the original database. Download the file <a href = "http://dynamodb-local.s3-website-us-west-2.amazonaws.com/dynamodb_local_latest">here.</a>
* To run DynamoDB Local, use this command from the terminal in the directory where you extracted the tar file: `java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar [options]`

#### Options: 
* -port port_number (8000 by default) 
* --inMemory (Run in memory).

### Using the adapter with DynamoDB remote
* Put your AWS access key and secret access key IDs along with the region in `credentials.json` in the root folder of your app. For example, 
```javascript
{ 
  "accessKeyId": "xxxxxxxxxxxxxx", 
  "secretAccessKey": "xxxxxxxxxxxxxxxxxx", 
  "region": "us-east-1" 
}
```
If this file is missing, the adapter will try to read host, port , IDs and key from the values you pass in the schema/model file. See below for an example.

### Schema/Model file (DynamoDB Local)
```javascript
    var dynSettings = {
      host: "localhost",
      port:"8000", 
      accessKeyId: "mykey",
      secretAccessKey:"secret"
    };
```

####Options:
- host: Address of the dynamodb server. Defaults to "localhost".
- port: Port number of the dynamodb server. Defaults to "8000".
- region: DynamoDB server region. Defaults to "ap-southeast-1".
- accessKeyId: Your access key id. Defaults to "fake".
- secretAccessKey: Your secret access key. Defaults to "fake".
- maxRetries: Number of connection retries. Defaults to 0.
- logLevel : Log level. Defaults to "debug".

####Model Definition
```javascript
    var Schema = require('jugglingdb').Schema;
    var schemaDynamo = new Schema('dynamodb', dynSettings);

    var User = schemaDynamo.define('User',dynSettings, {
      id : { type: String, keyType: "hash", uuid: true},
      name: { type: String },
      age: { type: Number},
      isDead: { type: Boolean},
      DOB: { type: Date, keyType: "range"},
      tasks: { type: String, sharding : true, splitter : "60kb"}
    }, {
      table : "User"
    });
```

### Schema/Model file (DynamoDB Remote)
- Settings are loaded by adapter from `credentials.json`.

####Model Definition
```javascript
    var Schema = require('jugglingdb').Schema;
    var schemaDynamo = new Schema('dynamodb'); // No dynSettings needed.

    var User = schemaDynamo.define('User', {  // No dynSettings passed in define
      id : { type: String, keyType: "hash", uuid: true},
      name: { type: String },
      age: { type: Number},
      isDead: { type: Boolean},
      DOB: { type: Date, keyType: "range"},
      tasks: { type: String, sharding : true, splitter : "60kb"}
    }, {
      table : "User",
      ReadCapacityUnits : 15,
      WriteCapacityUnits: 20
    });
```

####Explanation
- DynamoDB stores information in the form of tables. Each table has a collection of items. Think of items as a row in a table. Each
item in turn is a collection of attributes. Each attribute is stored in the database as a key:value pair.

#####Key Schema
- DynamoDB primary key is a composite key consiting of a hash key and a range key. For a given item in the table, the key schema can specify
one hash key or one hash key and a range key.
- To specify a given attribute as hash key, use `keyType: "hash"` along with its definition as shown in the above example.
- DynamoDB expects a hash key for every item that is created. If this value is not available at the time of creation, there is an option to use a UUID generator to generate the hash key. To use this option, specify `uuid: true` in the model definition.
- Similarly, attribute becomes a range key if keyType is set to "range".
- Make sure that the hash key and range keys are specified during CRUD operations. For most of these operations, hash key is a must and range key is optional, or conditional. Delete operation requires both hash and range keys. JugglingDB `destroy` method by default only
sends in the id of the model. To support destroy operation for items with range keys, add the following method in `lib/model.js` of JugglingDB
```javascript
    AbstractClass.prototype.remove = function (cb) {
        if (stillConnecting(this.constructor.schema, this, arguments)) return;

        var hashKey = this.schema.adapter._models[this.constructor.modelName].hashKey;
        var rangeKey = this.schema.adapter._models[this.constructor.modelName].rangeKey;

        this.trigger('destroy', function (destroyed) {
            this._adapter().remove(this.constructor.modelName, this[hashKey], this[rangeKey], function (err) {
                if (err) {
                    return cb(err);
                }

                destroyed(function () {
                    if(cb) cb();
                });
            }.bind(this));
        }, this.toObject(), cb);
    };
```
- To destroy an object with both hash and range key, use the following:
```javascript
    user.remove(function(err){
    if (err) {
    ....
    }
  });
```
#####Data Types
- DynamoDB supports only String, Binary, and Number datatypes along with their corresponding Sets.
- The adapter currently supports String, Number, Date and Boolean datatypes.
- Null, undefined and empty strings are handled by the adapter. However, invalid date or missing numbers might cause
DynamoDB to throw an error.
- Date is stored internally as a number, and boolean is stored as a string => `true` or `false`.

#####Read Write / Capacity Units
- Provisioned Throughput for each table can be specified by using the `set` property function of Jugglingdb. In the above example, the
read and write capacity units are set for `User`.
- The defaults for read and write capacity units are 5 and 10 respectively.

#####Database Limitations
- DynamoDB has an item size limit of 64 kb. Typically data is stored in the form of big strings in NoSQL tables (e.g objects with complex data structures). Eventually these strings might exceed 64 kb in size. To overcome this limitation, the adapter uses a sharding technique.

- When an attribute is being sharded, the attribute is separated from the parent table, and is stored in a different (child) table. According to the example above, tasks attribute will be stored in a new table called `User_tasks`. The primary key of User table `id`, is stored in the new table as `user#id`, and a new range key is assigned for every chunk that exceeds a given size. So if `splitter` is set to 60 kb, and the tasks string exceeds 60 kb, the structure of child table will be as shown below:

```
    {
      user#id: { "S" : "xxxxyyyyy" },
      tasks#ID: { "N" : "1" },
      tasks: { "S" : "This attribute has been broken" }
    }
    
    {
      user#id: { "S" : "xxxxyyyyy" },
      tasks#ID: { "N" : "2" },
      tasks: { "S" : "down into two different pieces" }
    }
```

- The attribute value (String) is broken down based on the size specified by the `splitter` attribute. For example, in the above given model definition, the tasks string is broken down into 60 kb chunks. Each chunk is stored as a new item with a range key and the primary key of parent item.

- Due to the large size of items being retrieved/written to the child tables, these tables require more read and write capacity compared to the original table. Read and write capacities for the child table can be specified as follows:
```javascript
     tasks: { type: String, sharding : true, splitter : "60kb" , read : 15, write: 20}
```
- When the main item is being retrieved from the database, the adapter queries each child table, and builds back the string. As a result, the data structure is still intact after retrieval.

####Upcoming features
- Support for `limit`, `order` keywords in query filters.
- Event emitters to notify that table has been created & is active.
- Support for Sets.
- Custom logging.
- Iterator to overcome 1 mb fetch limit for query and scan operator.

####Bugs, Features, Enhancements etc.
- The adapter is still in its development stage, and as a result the functionality is still lacking in some areas & few bugs are expected. Please create issues in the github repository to address these. Also please try to include a test case or error log if you are reporting a bug. Good luck!
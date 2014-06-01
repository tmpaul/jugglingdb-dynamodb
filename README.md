JugglingDB Adapter for DynamoDB
--------------------------------
* Dependencies : `aws-sdk`, `colors`.
* Installation: The adapter has not been published to the npm registry yet. Once a good set of tests are implemented, it will be published to npm registry. For now git clone the repository to the node_modules directory of your compound app.
*`git clone https://github.com/tmpaul/jugglingdb-dynamodb` or download as zip and paste manually.
* Make sure you have aws-sdk and colors already installed.

###Schema file
    var dynSettings = {host: "localhost", port:"8000", accessKeyId: "mykey", secretAccessKey:"secret"};

####Options:
- host: Address of the dynamodb server.
- port: Port number of the dynamodb server.
- region: DynamoDB server region. Defaults to "ap-southeast-1".
- accessKeyId: Your access key id. Defaults to "fake".
- secretAccessKey: Your secret access key. Defaults to "fake".
- ReadCapacityUnits: Provisioned read throughput. Defaults to 5.
- WriteCapacityUnits: Provisioned write throughput. Defaults to 10.

####Model Definition
    schema('dynamodb', dynSettings, function () {
    var User = describe('User', function () {
      property('id', Number, {null:false, keyType:"hash"});
      property('name', String, {default: "Name"});
      property('isHappy', Boolean, {default: "false"});
      property('dob', Date, {default: Date});
      set('restPath', pathTo.users);
      });
    });

####Usage
-Coming soon.
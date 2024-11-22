# conanproxy

Nodejs proxy in front of conanserver


## Dependencies

See https://github.com/compiler-explorer/infra/blob/main/setup-conan.sh

* nodejs 16 or higher
* python3
* sqlite3


## Local testing without data

* `sudo mkdir -p /home/ce/.conan_server/data`
* `sudo chown your-user -Rf /home/ce`
* `npm run devtest`

Go to http://127.0.0.1:1080/


## Why is this not typescript?!

The unfortunate truth is that this appliction is set up to quickly iterate on and not easily testable without production data,
while also being an application that you don't want to be offline for too long.

The CE Conan instance is a single instance that cannot be scaled horizontally due to the amount of binary library packages currently residing on the EBS gp2 disk linked to that instance.


## Infra

Our Infra scripts offer commands to assist with updating the code:
* `ce conan reloadwww` - to just do a `git pull` which will refresh static content like html and css pages
* `ce conan restart` - to restart both the Conan server and this application
* `ce conan login` - to login to the Conan instance and allow manual tweaking

Useful things to investigate issues on the instance after logging in:
* `sudo /usr/sbin/service ce-conan status` - show status of the service in charge of starting the Conan server and this application
* `sudo journalctl -u ce-conan -r` - show logging for the application (reversed order)
* The Conan server data is at `/home/ce/.conan_server`
* This application is at `/home/ubuntu/ceconan/conanproxy`
* The used Node version is at `/home/ubuntu/node` - currently v16.19.1
* To update the node_modules, from `/home/ubuntu/ceconan/conanproxy` you can run `sudo PATH=$PATH:/home/ubuntu/node/bin /home/ubuntu/node/bin/npm i`

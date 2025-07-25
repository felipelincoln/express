#!/bin/bash

API_URL="api.collectoor.com"
EMAIl="collectoor.felipelincoln@gmail.com"

# add nginx to yum repo
sudo tee /etc/yum.repos.d/nginx.repo > /dev/null <<EOF
[nginx-stable]
name=nginx stable repo
baseurl=http://nginx.org/packages/amzn/2023/\$basearch/
gpgcheck=1
enabled=1
gpgkey=https://nginx.org/keys/nginx_signing.key
module_hotfixes=true
priority=9
EOF

# install nginx
sudo yum install nginx -y

# setup nginx reverse proxy
sudo tee /etc/nginx/conf.d/default.conf > /dev/null <<EOF
server {
    listen 80;
    server_name $API_URL;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# start nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# install crontab
sudo dnf install cronie -y
sudo systemctl start crond
sudo systemctl enable crond

# setup certbot
sudo dnf install python3 augeas-libs -y
sudo python3 -m venv /opt/certbot/
sudo /opt/certbot/bin/pip install certbot certbot-nginx
sudo ln -s /opt/certbot/bin/certbot /usr/bin/certbot
echo "0 0 1 * * root /opt/certbot/bin/python -c 'import random; import time; time.sleep(random.random() * 3600)' && sudo certbot renew -q" | sudo tee -a /etc/crontab > /dev/null

# install git
sudo dnf install git -y

# install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

# install node and npm
nvm install 22

# install pm2
npm install pm2 -g

# generate ssh keypair
ssh-keygen -t ed25519 -N "" -C $EMAIl -f ~/.ssh/id_ed25519
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519

echo NEXT STEPS
echo '1. update elastic ip https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#AssociateAddressDetails:PublicIp=52.20.125.5;allocationId=eipalloc-01992d8f50c28c5bb'
echo "2. sudo certbot -n --nginx --agree-tos --email $EMAIl -d $API_URL"
echo '3. cat ~/.ssh/id_ed25519.pub'
echo '4. add the key to https://github.com/felipelincoln/express/settings/keys/new'
echo '5. git clone git@github.com:felipelincoln/express.git'
echo '6. add all variables ~/.bashrc'
echo '7. source ~/.bashrc'
echo '6. cd express && npm install && npm run build'
echo '7. npm run task:dbMigrate'
echo '8. pm2 start'
echo '9. pm2 save'
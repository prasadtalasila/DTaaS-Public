#!/bin/bash
# launch workspaces for 30 users

cd ../..
TOP_DIR=$(pwd)

docker run -d \
 -p 8090:8080 \
 --name "ml-workspace-admin" \
 -v "${TOP_DIR}/files/admin:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="admin" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2



docker run -d \
 -p 8091:8080 \
 --name "ml-workspace-user1" \
 -v "${TOP_DIR}/files/user1:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user1" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2



docker run -d \
 -p 8092:8080 \
 --name "ml-workspace-user2" \
 -v "${TOP_DIR}/files/user2:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user2" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8093:8080 \
 --name "ml-workspace-user3" \
 -v "${TOP_DIR}/files/user3:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user3" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8094:8080 \
 --name "ml-workspace-user4" \
 -v "${TOP_DIR}/files/user4:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user4" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8095:8080 \
 --name "ml-workspace-user5" \
 -v "${TOP_DIR}/files/user5:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user5" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8096:8080 \
 --name "ml-workspace-user6" \
 -v "${TOP_DIR}/files/user6:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user6" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8097:8080 \
 --name "ml-workspace-user7" \
 -v "${TOP_DIR}/files/user7:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user7" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8098:8080 \
 --name "ml-workspace-user8" \
 -v "${TOP_DIR}/files/user8:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user8" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8099:8080 \
 --name "ml-workspace-user9" \
 -v "${TOP_DIR}/files/user9:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user9" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8100:8080 \
 --name "ml-workspace-user10" \
 -v "${TOP_DIR}/files/user10:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user10" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8101:8080 \
 --name "ml-workspace-user11" \
 -v "${TOP_DIR}/files/user11:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user11" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8102:8080 \
 --name "ml-workspace-user12" \
 -v "${TOP_DIR}/files/user12:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user12" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8103:8080 \
 --name "ml-workspace-user13" \
 -v "${TOP_DIR}/files/user13:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user13" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8104:8080 \
 --name "ml-workspace-user14" \
 -v "${TOP_DIR}/files/user14:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user14" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8105:8080 \
 --name "ml-workspace-user15" \
 -v "${TOP_DIR}/files/user15:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user15" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8106:8080 \
 --name "ml-workspace-user16" \
 -v "${TOP_DIR}/files/user16:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user16" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8107:8080 \
 --name "ml-workspace-user17" \
 -v "${TOP_DIR}/files/user17:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user17" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8108:8080 \
 --name "ml-workspace-user18" \
 -v "${TOP_DIR}/files/user18:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user18" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8109:8080 \
 --name "ml-workspace-user19" \
 -v "${TOP_DIR}/files/user19:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user19" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8110:8080 \
 --name "ml-workspace-user20" \
 -v "${TOP_DIR}/files/user20:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user20" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8111:8080 \
 --name "ml-workspace-user21" \
 -v "${TOP_DIR}/files/user21:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user21" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8112:8080 \
 --name "ml-workspace-user22" \
 -v "${TOP_DIR}/files/user22:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user22" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8113:8080 \
 --name "ml-workspace-user23" \
 -v "${TOP_DIR}/files/user23:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user23" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8114:8080 \
 --name "ml-workspace-user24" \
 -v "${TOP_DIR}/files/user24:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user24" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8115:8080 \
 --name "ml-workspace-user25" \
 -v "${TOP_DIR}/files/user25:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user25" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8116:8080 \
 --name "ml-workspace-user26" \
 -v "${TOP_DIR}/files/user26:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user26" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8117:8080 \
 --name "ml-workspace-user27" \
 -v "${TOP_DIR}/files/user27:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user27" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8118:8080 \
 --name "ml-workspace-user28" \
 -v "${TOP_DIR}/files/user28:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user28" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8119:8080 \
 --name "ml-workspace-user29" \
 -v "${TOP_DIR}/files/user29:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user29" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


docker run -d \
 -p 8120:8080 \
 --name "ml-workspace-user30" \
 -v "${TOP_DIR}/files/user30:/workspace" \
 -v "${TOP_DIR}/files/common:/workspace/common:ro" \
 --env AUTHENTICATE_VIA_JUPYTER="" \
 --env WORKSPACE_BASE_URL="user30" \
 --shm-size 512m \
 --restart always \
 mltooling/ml-workspace:0.13.2


